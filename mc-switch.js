#!/usr/bin/node
const net = require('node:net');
const client = net.createConnection({ port: 7070 }, () => {
  // 'connect' listener.
  console.log('connected to server!');
});



setInterval( ()=>{
	client.write( `say hello world\n`);
},1000)
/*
client.on('data', (data) => {
  //console.log(data.toString());
});
client.on('end', () => {
  console.log('disconnected from server');
  process.exit(0)
}); 

*/

