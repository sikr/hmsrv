# hmsrv
Receive and send data from Homematic CCU, store data in an sqlite3 db and make data accessible via XHR/Websocket for web applications

hmsrv uses [hobbyquaker's](https://github.com/hobbyquaker) Homematic rega implementation and scripts from [ccu.io](https://github.com/hobbyquaker/ccu.io) as well as [binrpc](https://github.com/hobbyquaker/binrpc)

## Installation:

```
git clone https://github.com/sikr/hmsrv.git
cd hmsrv
npm install
```

Copy file js/options.dist.json to js/options.json and set the ip adress for the ccu and hmsrv (the system you're running hmsrv on)

To start on console:

    node js/hmsrv.js

To start as daemon/service:

    node hmsrv.d.js
