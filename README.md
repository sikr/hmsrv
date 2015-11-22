# hmsrv
Receive and send data from Homematic CCU, store data in sqlite3 db and make data accessible via XHR/Websocket for web applications

Installation:

    git clone ...
    npm install

Set IP adress of ccu and raspberry pi in file js/opitons.json

To start on console:

    node js/hmsrv.js

To start as daemon/service:

    node hmsrv.d.js
