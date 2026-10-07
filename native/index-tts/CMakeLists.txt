cmake_minimum_required(VERSION 3.20)

project(ls101-index-tts-helper VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Replaces the audio.cpp engine with a synthetic tone generator, so the stdio
# protocol and the argv layer compile and run without CUDA, audio.cpp or a model:
#   cmake -S native/index-tts -B build/stub -DLS101_INDEX_TTS_STUB_ENGINE=ON
option(LS101_INDEX_TTS_STUB_ENGINE "Build the synthetic tone engine instead of the audio.cpp engine" OFF)

set(AUDIOCPP_SOURCE_DIR "" CACHE PATH "Path to a pinned audio.cpp checkout (https://github.com/0xShug0/audio.cpp)")

add_executable(ls101-index-tts-helper main.cpp)
set_target_properties(ls101-index-tts-helper PROPERTIES OUTPUT_NAME ls101-index-tts-helper)

if(LS101_INDEX_TTS_STUB_ENGINE)
    target_compile_definitions(ls101-index-tts-helper PRIVATE LS101_INDEX_TTS_STUB_ENGINE)
    message(STATUS "ls101-index-tts-helper: stub engine (audio.cpp is not linked)")
else()
    if(NOT AUDIOCPP_SOURCE_DIR OR NOT EXISTS "${AUDIOCPP_SOURCE_DIR}/include/audiocpp.h")
        message(FATAL_ERROR
            "AUDIOCPP_SOURCE_DIR must point to an audio.cpp checkout containing include/audiocpp.h")
    endif()

    # The audio.cpp C ABI (include/audiocpp.h) and only the IndexTTS 2.x family.
    set(BUILD_SHARED_LIBS OFF CACHE BOOL "Build static libraries" FORCE)
    set(AUDIOCPP_BUILD_C_API ON CACHE BOOL "Build the C ABI as a shared library" FORCE)
    set(AUDIOCPP_MODEL_SET custom CACHE STRING "Model composite to build" FORCE)
    set(AUDIOCPP_MODELS index_tts2 CACHE STRING "Model targets for AUDIOCPP_MODEL_SET=custom" FORCE)
    add_subdirectory("${AUDIOCPP_SOURCE_DIR}" audiocpp EXCLUDE_FROM_ALL)

    target_link_libraries(ls101-index-tts-helper PRIVATE audiocpp)
    target_include_directories(ls101-index-tts-helper PRIVATE "${AUDIOCPP_SOURCE_DIR}/include")

    # libaudiocpp links the CUDA driver API (libcuda.so.1), which does not exist on a build machine
    # without a GPU, so linking the helper would otherwise fail with undefined cuMem*/cuDevice*
    # references. The toolkit ships a stub for exactly this case: linking it gives the helper a
    # NEEDED libcuda.so.1 entry that the real driver satisfies at runtime. It must never be shipped.
    if(UNIX AND NOT APPLE)
        find_library(LS101_CUDA_DRIVER_STUB
            NAMES cuda
            PATHS
                "$ENV{CUDA_PATH}/lib64/stubs"
                "$ENV{CUDA_HOME}/lib64/stubs"
                "/usr/local/cuda/lib64/stubs"
                "${CUDAToolkit_LIBRARY_ROOT}/lib64/stubs"
            NO_DEFAULT_PATH)
        if(LS101_CUDA_DRIVER_STUB)
            message(STATUS "ls101-index-tts-helper: linking the CUDA driver stub ${LS101_CUDA_DRIVER_STUB}")
            target_link_libraries(ls101-index-tts-helper PRIVATE "${LS101_CUDA_DRIVER_STUB}")
        else()
            message(STATUS "ls101-index-tts-helper: no CUDA driver stub found; allowing undefined driver symbols")
            target_link_options(ls101-index-tts-helper PRIVATE "-Wl,--allow-shlib-undefined")
        endif()
    endif()

    # libaudiocpp is a shared library, so the helper has to find it next to
    # itself when the runtime is shipped inside a model package.
    if(APPLE)
        set_target_properties(ls101-index-tts-helper PROPERTIES
            BUILD_RPATH "@loader_path"
            INSTALL_RPATH "@loader_path")
    elseif(UNIX)
        set_target_properties(ls101-index-tts-helper PROPERTIES
            BUILD_RPATH "$ORIGIN"
            INSTALL_RPATH "$ORIGIN")
    endif()
endif()

if(MSVC)
    target_compile_options(ls101-index-tts-helper PRIVATE /W4)
else()
    target_compile_options(ls101-index-tts-helper PRIVATE -Wall -Wextra -Wpedantic)
endif()

install(TARGETS ls101-index-tts-helper RUNTIME DESTINATION .)
