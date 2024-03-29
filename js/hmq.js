/*
 *  Query Homematic IDs and output the related device, channel or datapoint
 *
 *
 *
 */
var options    = require('./options.json');
var mode       = options.development ? 'development' : options.test ? 'test' : '';
var devices    = require(`../data/devices.${mode}.json`);
var channels   = require(`../data/channels.${mode}.json`);
var datapoints = require(`../data/datapoints.${mode}.json`);
var rooms      = require(`../data/rooms.${mode}.json`);

try {
  console.log('');  // empty line
  if (!process.argv[2]) {
    console.error(`Provide an id to look for...`);
    process.exit(1);
  }
  if (devices[process.argv[2]]) {
    console.log(`Device: ${JSON.stringify(devices[process.argv[2]], null, 2)}`);
  }
  else if (channels[process.argv[2]]) {
    console.log(`Channel: ${JSON.stringify(channels[process.argv[2]], null, 2)}`);
  }
  else if (datapoints[process.argv[2]]) {
    console.log(`Datapoint: ${JSON.stringify(datapoints[process.argv[2]], null, 2)}`);
  }
  else if (rooms[process.argv[2]]) {
    console.log(`Room: ${JSON.stringify(rooms[process.argv[2]], null, 2)}`);
  }
  else {
    console.error(`No device or channel or datapoint with id ${process.argv[2]}.`)
  }
}
catch(err) {
  console.log(`Error: ${err}`);
}
