# hmsrv
Receive and send data from Homematic CCU, store data in sqlite3 db and make data accessible via XHR/Websocket for web applications

hmsrv uses [hobbyquaker's](https://github.com/hobbyquaker) Homematic rega implementation and scripts from [ccu.io](https://github.com/hobbyquaker/ccu.io) as well as [binrpc](https://github.com/hobbyquaker/binrpc)

## Installation:

    git clone https://github.com/sikr/hmsrv.git
    npm install

Set IP adress of ccu and raspberry pi in file js/opitons.json

To start on console:

    node js/hmsrv.js

To start as daemon/service:

    node hmsrv.d.js
