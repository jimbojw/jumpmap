var fs = require('fs');

var ret = [];
var left = process.argv.length - 2;
var red = [3867, 2496, 2500, 2501, 2502, 1928];
var yellow = [54, 3868, 2498, 1929, 1932, 3866, 3871];
var green = [56, 57, 3870, 3869, 2499, 2497, 1531, 3865, 1927, 1926, 1931, 1530, 1529, 4023, 4024, 1930, 3872];

for (var i = 2, leni = process.argv.length; i < leni; i++) {
  var cb = (function(ii) {
    return function(err, data) {
      if (err) {
        throw err;
      }

      var nameMatches = process.argv[ii].match(/\/([\w- \+]+)\/solarsystem.staticdata/);
      if (nameMatches) {
        var name = nameMatches[1];
      } else {
        throw 'no name.';
      }

      var centerMatches =
        data.match(/center:\s+- (-?[\d\.\+e]+)\s+- (-?[\d\.\+e]+)\s+- (-?[\d\.\+e]+)\s/m);
      if (centerMatches) {
        var x = centerMatches[1];
        var y = centerMatches[2];
        var z = centerMatches[3];
      } else {
        throw 'no center.';
      }

      var securityMatches = data.match(/security: (-?[\d\.]+)\s/m);
      if (securityMatches) {
        var security = parseFloat(securityMatches[1]);
        if (security >= 0.5) {
          var securityClass = 'high';
        } else if (security > 0) {
          securityClass = 'low';
        } else {
          securityClass = 'null';
        }
      } else {
        var msg = 'no security';
        if (name) {
          msg += ' for ' + name;
        }
        msg += '.'
        throw msg;
      }

/*
      if (name === 'Arifsdald') {
        var typeIds = [];
        var good = false;
        var stationMatches = data.match(/\n( *)npcStations:([^\t]*)/m);
        while (stationMatches) {
          var shouldBreak = false;
          var spaces = stationMatches[1].length;
          var newData = stationMatches[2];
          var spacesRegexp = new RegExp('([^\t]*?[^ ]) {' + spaces + '}[^ ]');
          var newDataMatches = newData.match(spacesRegexp);
          if (!newDataMatches) {
            console.error('something is wrong maybe');
            break;
          }
          var typeIdMatches = newDataMatches[1].match(/^ *typeID: (\d+)$/gm);
          if (!typeIdMatches) {
            console.error('something is wrong maybe?');
            break;
          }

          for (var j = 0, lenj = typeIdMatches.length; j < lenj; j++) {
            var typeIdMatchesMatches = typeIdMatches[j].match(/^ *typeID: (\d+)$/);
            if (!typeIdMatchesMatches) {
              console.error('something is wrong maybe.');
              shouldBreak = true;
              break;
            }
            var typeId = parseInt(typeIdMatchesMatches[1], 10);
            if (green.indexOf(typeId) !== -1 || yellow.indexOf(typeId) !== -1) {
              good = true;
              break;
            } else if (red.indexOf(typeId) === -1) {
              console.error('station with typeid ' + typeId + ' not found.');
            }
          }
          if (shouldBreak || good) {
            break;
          }
          stationMatches = newData.match(/\n( *)npcStations:([^\t]*)/m);
        }
        console.error(good);
      }
*/

      // console.log(x, y, z, security, securityClass, name);
      if (securityClass !== 'high') {
//-----------------------------------------------------------------
        if (securityClass === 'low') {
          var typeIds = [];
          var good = false;
          var stationMatches = data.match(/\n( *)npcStations:([^\t]*)/m);
          while (stationMatches) {
            var shouldBreak = false;
            var spaces = stationMatches[1].length;
            var newData = stationMatches[2];
            var spacesRegexp = new RegExp('([^\t]*?[^ ]) {' + spaces + '}[^ ]');
            var newDataMatches = newData.match(spacesRegexp);
            if (!newDataMatches) {
              console.error('something is wrong maybe');
              break;
            }
            var typeIdMatches = newDataMatches[1].match(/^ *typeID: (\d+)$/gm);
            if (!typeIdMatches) {
              console.error('something is wrong maybe?');
              break;
            }
            
            for (var j = 0, lenj = typeIdMatches.length; j < lenj; j++) {
              var typeIdMatchesMatches = typeIdMatches[j].match(/^ *typeID: (\d+)$/);
              if (!typeIdMatchesMatches) {
                console.error('something is wrong maybe.');
                shouldBreak = true;
                break;
              }
              var typeId = parseInt(typeIdMatchesMatches[1], 10);
              if (green.indexOf(typeId) !== -1) {
                good = true;
                break;
              } else if (yellow.indexOf(typeId) === -1 && red.indexOf(typeId) === -1) {
                console.error('station with typeid ' + typeId + ' not found.');
              }
            }
            if (shouldBreak || good) {
              break;
            }
            stationMatches = newData.match(/\n( *)npcStations:([^\t]*)/m);
          }
        }

//-----------------------------------------------------------------
        if (good || securityClass === 'null') {
          ret.push({
            x: x,
            y: y,
            z: z,
            security: security,
            securityClass: securityClass,
            name: name
          });
        }
      }
      left--;
      if (left <= 0) {
        done();
      }
    };
  })(i);
  fs.readFile(process.argv[i], 'utf-8', cb);
}

function done() {
  for (var i = 0, leni = ret.length; i < leni; i++) {
    console.log(JSON.stringify(ret[i]));
  }
  console.error('done processing ' + (process.argv.length - 2) + ' systems.');
}
