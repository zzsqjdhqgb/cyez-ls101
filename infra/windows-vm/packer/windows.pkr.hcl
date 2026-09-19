packer {
  required_version = "= 1.14.1"
  required_plugins {
    vmware = {
      source  = "github.com/hashicorp/vmware"
      version = "= 1.1.0"
    }
    vagrant = {
      source  = "github.com/hashicorp/vagrant"
      version = "= 1.1.5"
    }
  }
}

variable "windows_iso" { type = string }
variable "windows_iso_sha256" { type = string }
variable "tools_iso" { type = string }
variable "tools_iso_sha256" { type = string }
variable "node_zip" { type = string }
variable "node_sha256" { type = string }
variable "node_version" { type = string }
variable "git_zip" { type = string }
variable "git_sha256" { type = string }
variable "image_index" { type = number }
variable "cpus" { type = number }
variable "memory" { type = number }
variable "disk_size" { type = number }
variable "output_directory" { type = string }
variable "box_output" { type = string }
variable "guest_password" {
  type      = string
  sensitive = true
}

source "vmware-iso" "windows" {
  vm_name              = "ls101-windows-server-2022"
  guest_os_type        = "windows2019srv-64"
  version              = 19
  firmware             = "bios"
  cpus                 = var.cpus
  memory               = var.memory
  disk_size            = var.disk_size
  disk_adapter_type    = "sata"
  cdrom_adapter_type   = "sata"
  network              = "nat"
  network_adapter_type = "e1000e"
  # Keep only the primary NAT adapter in the exported box. Vagrant on Windows
  # cannot configure secondary VMware adapters and otherwise prints a warning.
  vmx_remove_ethernet_interfaces = true
  # Use vmrun start ... nogui: GUI startup can block until Workstation closes.
  # https://github.com/vmware/packer-plugin-vmware/issues/280
  headless             = true
  iso_url              = var.windows_iso
  iso_checksum         = "sha256:${var.windows_iso_sha256}"
  output_directory     = var.output_directory
  boot_wait            = "2s"
  # Confirm the ISO's default Windows Setup [EMS Enabled] entry if the boot
  # keys leave Boot Manager waiting for input instead of starting Setup.
  boot_command         = ["<spacebar><wait1s><spacebar><wait1s><spacebar><wait2s><enter>"]
  # Packer creates a floppy itself: no ADK/oscdimg/mkisofs executable is required.
  floppy_content = {
    "Autounattend.xml" = templatefile("${path.root}/Autounattend.xml.pkrtpl", {
      password    = var.guest_password
      image_index = var.image_index
    })
    "bootstrap.ps1" = file("${path.root}/../guest/bootstrap.ps1")
  }
  communicator   = "winrm"
  winrm_username = "vagrant"
  winrm_password = var.guest_password
  winrm_use_ssl  = true
  winrm_insecure = true
  # Connect directly to the local VMware NAT guest, bypassing host HTTP proxies.
  winrm_no_proxy = true
  winrm_port     = 5986
  winrm_timeout  = "60m"
  shutdown_command   = "shutdown /s /t 10 /f /d p:4:1 /c \"Packer image complete\""
  shutdown_timeout   = "15m"
  skip_compaction    = true
}

build {
  sources = ["source.vmware-iso.windows"]

  # Plugin 1.1.0's vmware-iso builder omits ToolsSourcePath when constructing
  # StepPrepareTools, so built-in Tools upload selects Workstation's ISO.
  # Upload the verified project asset explicitly instead.
  provisioner "file" {
    source      = var.tools_iso
    destination = "C:/Windows/Temp/vmware-tools.iso"
  }
  provisioner "powershell" {
    environment_vars = ["LS101_TOOLS_SHA256=${var.tools_iso_sha256}"]
    script           = "${path.root}/../guest/install-tools.ps1"
  }
  provisioner "windows-restart" {
    restart_timeout = "20m"
  }
  provisioner "file" {
    source      = var.node_zip
    destination = "C:/Windows/Temp/node.zip"
  }
  provisioner "file" {
    source      = var.git_zip
    destination = "C:/Windows/Temp/mingit.zip"
  }
  provisioner "powershell" {
    environment_vars = [
      "LS101_NODE_SHA256=${var.node_sha256}",
      "LS101_GIT_SHA256=${var.git_sha256}",
      "LS101_NODE_VERSION=${var.node_version}"
    ]
    script = "${path.root}/../guest/prepare-dev.ps1"
  }
  provisioner "powershell" {
    script = "${path.root}/../guest/finalize.ps1"
  }
  post-processor "vagrant" {
    output               = var.box_output
    keep_input_artifact  = true
    compression_level    = 6
    vagrantfile_template = "${path.root}/box.Vagrantfile"
  }
}
