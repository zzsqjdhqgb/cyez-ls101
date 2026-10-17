cmake_minimum_required(VERSION 3.20)

project(ls101-index-tts-helper VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(AUDIOCPP_SOURCE_DIR "" CACHE PATH "Path to a pinned audio.cpp checkout")
if(NOT AUDIOCPP_SOURCE_DIR OR NOT EXISTS "${AUDIOCPP_SOURCE_DIR}/src/capi/audiocpp.cpp")
    message(FATAL_ERROR "AUDIOCPP_SOURCE_DIR must point to an audio.cpp checkout")
endif()

# Only the index_tts2 family is linked into the helper; every other model
# loader is compiled out so the binary stays as small as a single-model build.
set(AUDIOCPP_MODEL_SET "custom" CACHE STRING "Model composite to build" FORCE)
set(AUDIOCPP_MODELS "index_tts2" CACHE STRING "Model targets for the custom composite" FORCE)
set(AUDIOCPP_DEPLOYMENT_BUILD ON CACHE BOOL "Compile model specs into the runtime" FORCE)
set(AUDIOCPP_BUILD_C_API OFF CACHE BOOL "The helper compiles the C ABI itself" FORCE)
set(AUDIOCPP_BUILD_NATIVE_MODEL_MANAGER OFF CACHE BOOL "No model manager or HTTP stack" FORCE)

# Single static executable: no shared libraries, no host-specific ISA flags,
# no OpenMP runtime dependency, and no extra targets beyond the engine.
# ENGINE_ENABLE_CUDA / GGML_CUDA / CMAKE_CUDA_ARCHITECTURES are passed by the
# build script for the development-only CUDA variant.
set(BUILD_SHARED_LIBS OFF CACHE BOOL "Build static libraries" FORCE)
set(GGML_STATIC ON CACHE BOOL "ggml: static link libraries" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "ggml: portable CPU kernels" FORCE)
set(GGML_METAL OFF CACHE BOOL "ggml: no Metal backend" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "ggml: no OpenMP" FORCE)
set(ENGINE_ENABLE_OPENMP OFF CACHE BOOL "No OpenMP in host code" FORCE)
set(ENGINE_ENABLE_CPU_ALL_VARIANTS OFF CACHE BOOL "No per-ISA CPU variants" FORCE)
set(ENGINE_BUILD_EXAMPLES OFF CACHE BOOL "No upstream examples" FORCE)
set(ENGINE_BUILD_TESTS OFF CACHE BOOL "No upstream tests" FORCE)

add_subdirectory("${AUDIOCPP_SOURCE_DIR}" audiocpp)

add_executable(ls101-index-tts-helper
    main.cpp
    "${AUDIOCPP_SOURCE_DIR}/src/capi/audiocpp.cpp"
)
target_include_directories(ls101-index-tts-helper PRIVATE
    "${AUDIOCPP_SOURCE_DIR}/include"
)
target_link_libraries(ls101-index-tts-helper PRIVATE engine_runtime ggml)

# The request payload is JSON. Prefer the vendored cJSON target from the
# audio.cpp tree; when it is unavailable, compile the vendored sources directly
# so the wire format never depends on how the runtime was configured.
if(TARGET cjson_vendor)
    target_link_libraries(ls101-index-tts-helper PRIVATE cjson_vendor)
else()
    target_sources(ls101-index-tts-helper PRIVATE
        "${AUDIOCPP_SOURCE_DIR}/external/cJSON/cJSON.c"
    )
    target_include_directories(ls101-index-tts-helper PRIVATE
        "${AUDIOCPP_SOURCE_DIR}/external/cJSON"
    )
    target_compile_definitions(ls101-index-tts-helper PRIVATE CJSON_HIDE_SYMBOLS)
endif()

if(MSVC)
    target_compile_options(ls101-index-tts-helper PRIVATE /utf-8)
else()
    target_compile_options(ls101-index-tts-helper PRIVATE -Wall -Wextra)
endif()

install(TARGETS ls101-index-tts-helper RUNTIME DESTINATION .)
