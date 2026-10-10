cmake_minimum_required(VERSION 3.20)
project(ls101-index-tts-helper VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
set(AUDIOCPP_SOURCE_DIR "" CACHE PATH "Pinned audio.cpp checkout")
if(NOT EXISTS "${AUDIOCPP_SOURCE_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "AUDIOCPP_SOURCE_DIR must point to the pinned audio.cpp checkout")
endif()

set(AUDIOCPP_BUILD_C_API ON CACHE BOOL "Build embedding library" FORCE)
set(AUDIOCPP_DEPLOYMENT_BUILD ON CACHE BOOL "Embed model specs" FORCE)
set(AUDIOCPP_MODEL_SET custom CACHE STRING "Build selected models" FORCE)
set(AUDIOCPP_MODELS index_tts2 CACHE STRING "Required model family" FORCE)
set(ENGINE_ENABLE_NATIVE_CPU OFF CACHE BOOL "Portable CPU instructions" FORCE)
set(ENGINE_ENABLE_CPU_ALL_VARIANTS OFF CACHE BOOL "Static GGML backends" FORCE)
set(ENGINE_ENABLE_HIP OFF CACHE BOOL "No HIP" FORCE)
set(ENGINE_ENABLE_METAL OFF CACHE BOOL "No Metal" FORCE)
set(ENGINE_ENABLE_VULKAN OFF CACHE BOOL "No Vulkan" FORCE)
set(ENGINE_ENABLE_LLAMAFILE OFF CACHE BOOL "No llamafile" FORCE)
add_subdirectory("${AUDIOCPP_SOURCE_DIR}" audiocpp EXCLUDE_FROM_ALL)
if(TARGET ggml-cuda)
  # Unused variables in vendored CUDA templates produce thousands of repeated
  # diagnostics and instantiation traces. Suppress only those diagnostic IDs.
  target_compile_options(ggml-cuda PRIVATE
    "$<$<COMPILE_LANG_AND_ID:CUDA,NVIDIA>:--diag-suppress=177,550>"
  )
endif()
if(WIN32)
  # Windows expands INFINITY to a float cast of 1e+300. NVCC warns about the
  # intentional overflow used for infinity sentinels in these vendored targets.
  foreach(cuda_target IN ITEMS ggml-cuda engine_runtime)
    if(TARGET ${cuda_target})
      target_compile_options(${cuda_target} PRIVATE
        "$<$<COMPILE_LANG_AND_ID:CUDA,NVIDIA>:--diag-suppress=221>"
      )
    endif()
  endforeach()
endif()
# This private library is always shipped with its matching helper. Keep a single
# filename in the runtime bundle instead of platform-specific version symlinks.
set_property(TARGET audiocpp PROPERTY VERSION)
set_property(TARGET audiocpp PROPERTY SOVERSION)
set_target_properties(audiocpp PROPERTIES BUILD_WITH_INSTALL_RPATH ON INSTALL_RPATH "$ORIGIN")

add_executable(ls101-index-tts-helper main.cpp)
target_link_libraries(ls101-index-tts-helper PRIVATE audiocpp cjson_vendor)
if(WIN32)
  target_link_libraries(ls101-index-tts-helper PRIVATE shell32)
endif()
set_target_properties(ls101-index-tts-helper PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
  BUILD_WITH_INSTALL_RPATH ON
  BUILD_RPATH "$ORIGIN"
  INSTALL_RPATH "$ORIGIN"
)
if(MSVC)
  target_sources(ls101-index-tts-helper PRIVATE "${AUDIOCPP_SOURCE_DIR}/tools/cmake/audiocpp_utf8.manifest")
  target_compile_options(engine_core PRIVATE /utf-8)
  target_compile_options(engine_model_index_tts2 PRIVATE /utf-8)
  target_compile_options(audiocpp PRIVATE /utf-8)
  target_compile_options(ls101-index-tts-helper PRIVATE /W4 /utf-8)
else()
  target_compile_options(ls101-index-tts-helper PRIVATE -Wall -Wextra -Wpedantic)
endif()

# List actual target outputs rather than scanning bin/ for stale libraries.
file(GENERATE OUTPUT "${CMAKE_BINARY_DIR}/runtime-files.txt" CONTENT
  "$<TARGET_FILE:ls101-index-tts-helper>\n$<TARGET_FILE:audiocpp>\n")
file(GENERATE OUTPUT "${CMAKE_BINARY_DIR}/toolchain.json" CONTENT
  "{\"compiler\":\"${CMAKE_CXX_COMPILER_ID}\",\"compilerVersion\":\"${CMAKE_CXX_COMPILER_VERSION}\",\"cudaVersion\":\"${CMAKE_CUDA_COMPILER_VERSION}\",\"generator\":\"${CMAKE_GENERATOR}\"}\n")

include(CTest)
if(BUILD_TESTING)
  add_executable(index-tts-audio-test tests/audio-test.cpp)
  add_test(NAME index-tts-audio COMMAND index-tts-audio-test)
endif()
install(TARGETS ls101-index-tts-helper audiocpp RUNTIME DESTINATION . LIBRARY DESTINATION .)
