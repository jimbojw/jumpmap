var fs = require('fs');
var bigInt = require('big-integer');
var data, nodes = [], nodes2 = [], edges = [], seven2 = bigInt("4.3864129e+33");
fs.readFile('/home/mitch/evesystems.json', 'utf-8', function(err, rawdata) {
  if (err) {
    throw err;
  }
  data = JSON.parse(rawdata);
  makeNodes();
  makeEdges();
  cleanNodes();
  printJson();
});

function makeNodes() {
  for (var i = 0, leni = data.length; i < leni; i++) {
    var id = data[i].name;
    var sec = data[i].securityClass;
    if (sec === 'high') {
      var group = 2;
    } else if (sec === 'low') {
      group = 1;
    } else {
      group = 0;
    }
    nodes.push({
      id: id,
      group: group
    });
    nodes2.push(id);
  }
}

function makeEdges() {
  for (var i = 0, leni = data.length; i < leni; i++) {
    var inode = nodes[i],
        idata = data[i];
    if (inode.group !== 1) {
      continue;
    }
    for (var j = 0, lenj = data.length; j < lenj; j++) {
      var jnode = nodes[j],
          jdata = data[j];
      if (jnode.group !== 0) {
        continue;
      }
      var ix = bigInt(idata.x.replace(/\.0$/, '')),
          iy = bigInt(idata.y.replace(/\.0$/, '')),
          iz = bigInt(idata.z.replace(/\.0$/, '')),
          jx = bigInt(jdata.x.replace(/\.0$/, '')),
          jy = bigInt(jdata.y.replace(/\.0$/, '')),
          jz = bigInt(jdata.z.replace(/\.0$/, '')),
          dx = ix.subtract(jx),
          dy = iy.subtract(jy),
          dz = iz.subtract(jz),
          dx2 = dx.square(),
          dy2 = dy.square(),
          dz2 = dz.square(),
          dist2 = dx2.add(dy2).add(dz2);
      if (dist2.compare(seven2) === -1) {
        edges.push({
          source: inode.id,
          target: jnode.id,
          value: 1
        });
        found = true;
        var ii = nodes2.indexOf(inode.id);
        if (ii !== -1) {
          nodes2.splice(ii, 1);
        }
        ii = nodes2.indexOf(jnode.id);
        if (ii !== -1) {
          nodes2.splice(ii, 1);
        }
      }
    }
  }
}

function cleanNodes() {
  nodes = nodes.filter(function(e, i, a) {
    if (nodes2.indexOf(e.id) !== -1) {
      return false;
    }
    return true;
  });
}

function printJson() {
  var ret = {nodes: nodes, links: edges};
  console.log(JSON.stringify(ret));
}
