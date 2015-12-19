# hmsrv
Receive and send data from Homematic CCU, store data in an sqlite3 db and make data accessible via XHR/Websocket for web applications

hmsrv uses [hobbyquaker's](https://github.com/hobbyquaker) Homematic rega implementation and scripts from [ccu.io](https://github.com/hobbyquaker/ccu.io) as well as [binrpc](https://github.com/hobbyquaker/binrpc)

## Installation:

```
git clone https://github.com/sikr/hmsrv.git
cd hmsrv
npm install
bower install
```
## Configuration:

Copy file js/options.dist.json to js/options.json and set the ip adress for the ccu and hmsrv (the system you're running hmsrv on)

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
