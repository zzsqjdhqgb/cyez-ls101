cmake_minimum_required(VERSION 3.20)

project(ls101-index-tts-helper VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(AUDIOCPP_SOURCE_DIR "" CACHE PATH "Path to a pinned audio.cpp checkout")
if(NOT AUDIOCPP_SOURCE_DIR OR NOT EXISTS "${AUDIOCPP_SOURCE_DIR}/src/capi/audiocpp.cpp")
    message(FATAL_ERROR "AUDIOCPP_SOURCE_DIR must point to audio.cpp")
endif()

# Link only the IndexTTS2 family. Model specs are compiled in so the helper never
# searches the working directory for model_specs/*.json.
set(AUDIOCPP_MODEL_SET "custom" CACHE STRING "" FORCE)
set(AUDIOCPP_MODELS "index_tts2" CACHE STRING "" FORCE)
set(AUDIOCPP_DEPLOYMENT_BUILD ON CACHE BOOL "" FORCE)
set(AUDIOCPP_BUILD_C_API OFF CACHE BOOL "" FORCE)
set(AUDIOCPP_BUILD_NATIVE_MODEL_MANAGER OFF CACHE BOOL "" FORCE)
set(AUDIOCPP_STATIC_ESPEAK OFF CACHE BOOL "" FORCE)
# Single static executable: no backend DLLs, no CPU variant DLLs, no OpenMP runtime DLL.
set(ENGINE_ENABLE_CPU_ALL_VARIANTS OFF CACHE BOOL "" FORCE)
set(ENGINE_ENABLE_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(ENGINE_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(ENGINE_BUILD_TESTS OFF CACHE BOOL "" FORCE)
add_subdirectory("${AUDIOCPP_SOURCE_DIR}" audiocpp EXCLUDE_FROM_ALL)

# The C ABI translation unit is compiled straight into the helper (static, no DLL).
add_executable(ls101-index-tts-helper main.cpp "${AUDIOCPP_SOURCE_DIR}/src/capi/audiocpp.cpp")
target_include_directories(ls101-index-tts-helper PRIVATE "${AUDIOCPP_SOURCE_DIR}/include")
target_compile_definitions(ls101-index-tts-helper PRIVATE AUDIOCPP_VERSION_STRING="ls101")
target_link_libraries(ls101-index-tts-helper PRIVATE engine_runtime ggml)

if(MSVC)
    target_compile_options(ls101-index-tts-helper PRIVATE $<$<COMPILE_LANGUAGE:CXX>:/utf-8>)
endif()

install(TARGETS ls101-index-tts-helper RUNTIME DESTINATION .)
