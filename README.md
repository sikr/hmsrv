# hmsrv
Receive data from Homematic CCU, store data in an graphite db and make data accessible via Websocket for web applications

hmsrv uses [hobbyquaker's](https://github.com/hobbyquaker) Homematic rega implementation and scripts from [ccu.io](https://github.com/hobbyquaker/ccu.io) as well as [binrpc](https://github.com/hobbyquaker/binrpc)

## Installation:

```
git clone https://github.com/sikr/hmsrv.git
cd hmsrv
yarn
yarn run webpack
```
## Configuration:

Copy file js/options.dist.json to js/options.json and set the ip adresses for the ccu and hmsrv (the system you're running hmsrv on) and provide rpc ports. Mail and Pushover support will be added soon.

## Start

### To start on console:

    node js/hmsrv.js

### To start (and automatically restart) via systemd:

I'm not a systemd expert, but this works for me.

Create a service file in /etc/systemd/system and name it "hmsrv.service"
```
[Service]
ExecStart=/usr/local/bin/node /home/pi/hmsrv/js/hmsrv.js
Restart=always
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=hmsrv
User=pi
#Group=nobody
Environment=NODE_ENV=production
WorkingDirectory=/home/pi/hmsrv/js
```

Enable the service:
```
    systemctl enable hmsrv
```

Start the service:
```
    systemctl start hmsrv
```
