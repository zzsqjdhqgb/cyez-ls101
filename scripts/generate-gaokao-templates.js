/*
 * Generates 5 standalone (flat) gaokao speaking templates from
 * the SH-gaokao-speaking chunk files.
 *
 * Usage: node scripts/generate-gaokao-templates.js
 */

const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.join(__dirname, '..', 'templates');
const SOURCE_CHUNK_DIR = path.join(TEMPLATES_DIR, 'SH-gaokao-speaking', 'chunk');

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

function writeJSON(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
  console.log('Created:', path.basename(path.dirname(filePath)) + '/' + path.basename(filePath));
}

/**
 * Deep-clone an object and replace old recordIndex values with new ones,
 * and re-index question IDs.
 */
function deepCloneAndRemap(obj, mapping) {
  return JSON.parse(JSON.stringify(obj, (key, val) => {
    if (key === 'recordIndex' && typeof val === 'number') {
      if (mapping.recordIndex && mapping.recordIndex[val] !== undefined) {
        return mapping.recordIndex[val];
      }
    }
    if (key === 'recordIndices' && Array.isArray(val)) {
      return val.map(v => {
        if (mapping.recordIndex && mapping.recordIndex[v] !== undefined) {
          return mapping.recordIndex[v];
        }
        return v;
      });
    }
    return val;
  }));
}

function remapQuestionIds(questions, idMapping) {
  return questions.map(q => {
    const newQ = JSON.parse(JSON.stringify(q));
    if (idMapping[q.id] !== undefined) {
      newQ.id = idMapping[q.id];
    }
    return newQ;
  });
}

function remapGradingInfo(gradingInfo, idMapping, recordIndexMapping) {
  return gradingInfo.map((g, i) => {
    const newG = JSON.parse(JSON.stringify(g));
    if (idMapping[g.id] !== undefined) {
      newG.id = idMapping[g.id];
    }
    if (g.recordIndices && recordIndexMapping) {
      newG.recordIndices = g.recordIndices.map(ri =>
        recordIndexMapping[ri] !== undefined ? recordIndexMapping[ri] : ri
      );
    }
    return newG;
  });
}

// ============================================================
// Template 1: gaokao-reading — 朗读句子+朗读短文
// Merges chunk 01 (sentence reading) + chunk 02 (passage reading)
// ============================================================
function generateReadingTemplate() {
  const c1 = readJSON(path.join(SOURCE_CHUNK_DIR, '01_sectionA_reading.json'));
  const c2 = readJSON(path.join(SOURCE_CHUNK_DIR, '02_sectionB_passage.json'));

  // Question IDs: 1-5 (c1) + 6-8 (c2) → already fine, keep as-is
  // recordIndices: 1,2 (c1) + 3 (c2) → already fine
  // gradingInfo IDs: 0 (c1) + 1 (c2) → already fine
  // This merge is naturally continuous — no remapping needed

  const output = {
    examData: {
      title: '高考英语听说 - 朗读句子与短文',
      questions: [
        ...c1.examData.questions,
        ...c2.examData.questions,
      ],
      gradingInfo: [
        ...c1.examData.gradingInfo,
        ...c2.examData.gradingInfo,
      ],
    },
    editableData: [
      ...c1.editableData,
      ...c2.editableData,
    ],
    dev: true,
  };

  writeJSON(path.join(TEMPLATES_DIR, 'gaokao-reading', 'template.json'), output);
}

// ============================================================
// Template 2: gaokao-situation — 情景提问
// From chunk 03
// ============================================================
function generateSituationTemplate() {
  const c = readJSON(path.join(SOURCE_CHUNK_DIR, '03_sectionC_situation.json'));

  // Re-index: question IDs 9-13 → 1-5, recordIndices 4-5 → 1-2, gradingInfo IDs 2-3 → 0-1
  const qIdMap = { '9': '1', '10': '2', '11': '3', '12': '4', '13': '5' };
  const riMap = { 4: 1, 5: 2 };
  const giIdMap = { 2: 0, 3: 1 };

  const output = {
    examData: {
      title: '高考英语听说 - 情景提问',
      questions: remapQuestionIds(c.examData.questions, qIdMap),
      gradingInfo: remapGradingInfo(c.examData.gradingInfo, giIdMap, riMap),
    },
    editableData: c.editableData,
    dev: true,
  };

  // Remap recordIndices in questions as well
  output.examData.questions = output.examData.questions.map(q => {
    const qCopy = { ...q };
    if (qCopy.time && typeof qCopy.time.recordIndex === 'number') {
      if (riMap[qCopy.time.recordIndex] !== undefined) {
        qCopy.time = { ...qCopy.time, recordIndex: riMap[qCopy.time.recordIndex] };
      }
    }
    return qCopy;
  });

  writeJSON(path.join(TEMPLATES_DIR, 'gaokao-situation', 'template.json'), output);
}

// ============================================================
// Template 3: gaokao-picture — 看图说话
// From chunk 04
// ============================================================
function generatePictureTemplate() {
  const c = readJSON(path.join(SOURCE_CHUNK_DIR, '04_sectionD_picture.json'));

  // Re-index: question IDs 14-16 → 1-3, recordIndex 6 → 1, gradingInfo ID 4 → 0
  const qIdMap = { '14': '1', '15': '2', '16': '3' };
  const riMap = { 6: 1 };
  const giIdMap = { 4: 0 };

  const output = {
    examData: {
      title: '高考英语听说 - 看图说话',
      questions: remapQuestionIds(c.examData.questions, qIdMap),
      gradingInfo: remapGradingInfo(c.examData.gradingInfo, giIdMap, riMap),
    },
    editableData: c.editableData,
    dev: true,
  };

  output.examData.questions = output.examData.questions.map(q => {
    const qCopy = { ...q };
    if (qCopy.time && typeof qCopy.time.recordIndex === 'number') {
      if (riMap[qCopy.time.recordIndex] !== undefined) {
        qCopy.time = { ...qCopy.time, recordIndex: riMap[qCopy.time.recordIndex] };
      }
    }
    return qCopy;
  });

  writeJSON(path.join(TEMPLATES_DIR, 'gaokao-picture', 'template.json'), output);
}

// ============================================================
// Template 4: gaokao-quickresponse — 快速应答
// From chunk 05
// ============================================================
function generateQuickResponseTemplate() {
  const c = readJSON(path.join(SOURCE_CHUNK_DIR, '05_LS_sectionA_quickresponse.json'));

  // Re-index: question IDs 17-25 → 1-9, recordIndices 7-10 → 1-4, gradingInfo IDs 5-8 → 0-3
  const qIdMap = {
    '17': '1', '18': '2', '19': '3', '20': '4', '21': '5',
    '22': '6', '23': '7', '24': '8', '25': '9',
  };
  const riMap = { 7: 1, 8: 2, 9: 3, 10: 4 };
  const giIdMap = { 5: 0, 6: 1, 7: 2, 8: 3 };

  const output = {
    examData: {
      title: '高考英语听说 - 快速应答',
      questions: remapQuestionIds(c.examData.questions, qIdMap),
      gradingInfo: remapGradingInfo(c.examData.gradingInfo, giIdMap, riMap),
    },
    editableData: c.editableData,
    dev: true,
  };

  output.examData.questions = output.examData.questions.map(q => {
    const qCopy = { ...q };
    if (qCopy.time && typeof qCopy.time.recordIndex === 'number') {
      if (riMap[qCopy.time.recordIndex] !== undefined) {
        qCopy.time = { ...qCopy.time, recordIndex: riMap[qCopy.time.recordIndex] };
      }
    }
    return qCopy;
  });

  writeJSON(path.join(TEMPLATES_DIR, 'gaokao-quickresponse', 'template.json'), output);
}

// ============================================================
// Template 5: gaokao-listening — 听短文回答问题
// From chunk 06
// ============================================================
function generateListeningTemplate() {
  const c = readJSON(path.join(SOURCE_CHUNK_DIR, '06_LS_sectionB_passage.json'));

  // Re-index: question IDs 26-34 → 1-9, recordIndices 11-12 → 1-2, gradingInfo IDs 9-10 → 0-1
  const qIdMap = {
    '26': '1', '27': '2', '28': '3', '29': '4', '30': '5',
    '31': '6', '32': '7', '33': '8', '34': '9',
  };
  const riMap = { 11: 1, 12: 2 };
  const giIdMap = { 9: 0, 10: 1 };

  const output = {
    examData: {
      title: '高考英语听说 - 听短文回答问题',
      questions: remapQuestionIds(c.examData.questions, qIdMap),
      gradingInfo: remapGradingInfo(c.examData.gradingInfo, giIdMap, riMap),
    },
    editableData: c.editableData,
    dev: true,
  };

  output.examData.questions = output.examData.questions.map(q => {
    const qCopy = { ...q };
    if (qCopy.time && typeof qCopy.time.recordIndex === 'number') {
      if (riMap[qCopy.time.recordIndex] !== undefined) {
        qCopy.time = { ...qCopy.time, recordIndex: riMap[qCopy.time.recordIndex] };
      }
    }
    return qCopy;
  });

  writeJSON(path.join(TEMPLATES_DIR, 'gaokao-listening', 'template.json'), output);
}

// ============================================================
// Run all generators
// ============================================================
console.log('Generating gaokao sub-templates from SH-gaokao-speaking chunks...\n');

generateReadingTemplate();
generateSituationTemplate();
generatePictureTemplate();
generateQuickResponseTemplate();
generateListeningTemplate();

console.log('\nAll 5 templates generated successfully.');
