#!/usr/bin/node
const net = require('node:net');
const client = net.createConnection({ port: 7070 }, () => {
  // 'connect' listener.
  console.log('connected to server!');
});


client.on('data', (data) => {
  //console.log(data.toString());
});


client.on('end', () => {
  console.log('disconnected from server');
  process.exit(0)
}); 


setInterval( updateClock, 1000 );


function updateClock() {
  const d = new Date();
  const str = pad(d.getHours())+":"+pad(d.getMinutes())+":"+pad(d.getSeconds());
  const pic = strToPic(str);
  pic.forEach( (line)=>console.log( line.join( '' )))
	console.log()
  setPic( 0, 150, 500, pic );
}
function setPic( x,y,z, pic ) {
  for( let yo=0; yo<pic.length; yo++ ) {
    for( let xo=0; xo<pic[yo].length; xo++ ) {
      if( pic[yo][xo] == "#" ) {
        setBlock(x+xo, y+pic.length-1-yo, z, "minecraft:lime_wool" );
      }
      if( pic[yo][xo] == " " ) {
        setBlock(x+xo, y+pic.length-1-yo, z, "minecraft:stone" );
      }
    }
  }
}

function strToPic(str) {
  const template = `
0__ 1__ 2__ 3__ 4__ 5__ 6__ 7__ 8__ 9__ :__ X
###   # ### ### # # ### ### ### ### ###     X
# #   #   #   # # # #   #     # # # # #  #  X
# #   # ### ### ### ### ###   # ### ###     X
# #   # #     #   #   # # #   # # #   #  #  X
###   # ### ###   # ### ###   # ###   #     X
`;

  const lines = template.split( /\n/ );
  const index = {};
  for( var i=0; i<lines[1].length; i+=4 ) {
    index[""+lines[1][i]] = i;
  }
  
  var outLines = [[' '],[' '],[' '],[' '],[' ']];
  for( i=0; i<str.length;i++ ) {
    var off = index[str[i]];
    for( row=0;row<5;++row ) {
      const rowText = lines[row+2];
      for( col=0;col<4;++col ) {
        outLines[row].push(rowText.substr(off+col,1));
      }
   }
  } 
  //outLines.forEach( (item)=>{ console.log( item.join( "" )); });
  return outLines;
}

// zero pad 2 digit numbers
function pad(n) {
  return ('0'+n).slice(-2);
}

function setBlock(x,y,z,type ) {
  client.write( `setBlock ${x} ${y} ${z} ${type}\n` )
}


