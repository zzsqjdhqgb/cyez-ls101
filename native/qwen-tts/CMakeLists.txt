cmake_minimum_required(VERSION 3.20)

project(ls101-qwen-tts-helper VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(QWEN3_TTS_SOURCE_DIR "" CACHE PATH "Path to a pinned qwen3-tts.cpp checkout")
if(NOT QWEN3_TTS_SOURCE_DIR OR NOT EXISTS "${QWEN3_TTS_SOURCE_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "QWEN3_TTS_SOURCE_DIR must point to qwen3-tts.cpp")
endif()

set(BUILD_SHARED_LIBS OFF CACHE BOOL "Build static libraries" FORCE)
set(QWEN3_TTS_COREML OFF CACHE BOOL "Disable non-CPU backends" FORCE)
add_subdirectory("${QWEN3_TTS_SOURCE_DIR}" qwen3-tts EXCLUDE_FROM_ALL)

add_executable(ls101-qwen-tts-helper main.cpp)
target_include_directories(ls101-qwen-tts-helper PRIVATE "${QWEN3_TTS_SOURCE_DIR}/src")
target_link_libraries(ls101-qwen-tts-helper PRIVATE qwen3_tts)

if(MSVC)
    target_compile_options(ls101-qwen-tts-helper PRIVATE /W4)
else()
    target_compile_options(ls101-qwen-tts-helper PRIVATE -Wall -Wextra -Wpedantic)
endif()

install(TARGETS ls101-qwen-tts-helper RUNTIME DESTINATION .)
