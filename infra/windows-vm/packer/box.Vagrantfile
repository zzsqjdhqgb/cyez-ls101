Vagrant.configure('2') do |config|
  config.vm.guest = :windows
  config.vm.communicator = 'winrm'
  config.winrm.username = 'vagrant'
  config.winrm.transport = :ssl
  config.winrm.ssl_peer_verification = false
  config.winrm.port = 5986
  config.vm.synced_folder '.', '/vagrant', disabled: true
end
