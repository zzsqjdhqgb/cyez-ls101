@{
    # Copy to config.local.psd1. Obtain hashes from the sources listed in SOURCES.md.
    # Never use the hash of an untrusted download as proof of its origin.
    PackerVersion = '1.14.1'
    PackerSha256 = '3b9a51744e343b696a15a490500758ce1f864632878d710ed18688e221639b97'
    NodeVersion = '24.20.0'
    NodeSha256 = '6cac9ffbca8f6a47091e4b5c772e0606049c3871cb67d900c0cedde630e545ba'
    MinGitVersion = '2.49.0'
    MinGitRelease = 'v2.49.0.windows.1'
    MinGitSha256 = '971cdee7c0feaa1e41369c46da88d1000a24e79a6f50191c820100338fb7eca5'

    # Local paths are relative to infra/windows-vm, or absolute.
    # Copy these ISOs here manually; the scripts do not scrape Microsoft/Broadcom portals.
    WindowsIso = '.local/downloads/windows-server-2022-eval.iso'
    WindowsIsoSha256 = 'REPLACE_WITH_REVIEWED_WINDOWS_ISO_SHA256'
    VMwareToolsIso = '.local/downloads/windows-vmware-tools.iso'
    VMwareToolsIsoSha256 = 'REPLACE_WITH_REVIEWED_VMWARE_TOOLS_ISO_SHA256'

    # English Server 2022 evaluation ISO: usually 2 = Standard Desktop Experience.
    # Inspect YOUR ISO with DISM as described in README.md before setting this.
    WindowsImageIndex = 2
    GuestPassword = 'REPLACE_WITH_A_LOCAL_LAB_PASSWORD'
    # Password: 12-64 characters, uppercase + lowercase + digit + one of !#._-
    # No production credentials. Used for the local administrator named "vagrant".
    Cpus = 4
    MemoryMB = 8192
    DiskMB = 131072
}
