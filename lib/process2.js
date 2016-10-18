'use strict';

const fs = require('fs');
const filename = process.argv[2];

if (!filename) {
  throw Error('No filename provided');
}

const MAX_JUMP_DISTANCE = 6.622512e+16;  // 7 lightyears in meters.
const MAX_JUMP_DISTANCE_SQ = MAX_JUMP_DISTANCE * MAX_JUMP_DISTANCE;

/**
 * Given the raw input data, create a hash of each system type. There are two
 * types of systems we're interested in: stations and targets. A station is
 * any system which has station rating greater than zero, and a target is any
 * null-sec system.
 *
 * It's possible for a system to be both a station and a target. In that case,
 * the system will appear in both hashes.
 *
 * System names are presumed to be uniquely identifying IDs.
 */
function parseDataIntoSystems(rawdata) {
  const stations = {};
  const targets = {};

  const lines = rawdata.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\S/.test(line)) {
      continue;
    }

    const system = JSON.parse(line);
    if (system.name in stations || system.name in targets) {
      throw Error(`Duplicate system name: ${system.name}`);
    }

    if (system.stationRating > 2) {
      stations[system.name] = system;
    }

    if (system.securityClass === 'null') {
      targets[system.name] = system;
    }
  }

  return {stations, targets};
}

/**
 * Given a system, return a key for looking up its containing cube in the grid.
 */
function getKey(system) {
  return [
    Math.floor(system.x / MAX_JUMP_DISTANCE),
    Math.floor(system.y / MAX_JUMP_DISTANCE),
    Math.floor(system.z / MAX_JUMP_DISTANCE),
  ];
}

/**
 * Given a systems hash, partition the systems into a hash of cubes.
 */
function partitionIntoCubes(systems) {
  const cubes = {};
  for (let name in systems) {
    const system = systems[name];
    const key = getKey(system);
    if (!(key in cubes)) {
      cubes[key] = {key, systems: {}};
    }
    cubes[key].systems[system.name] = system;
  }
  return cubes;
}

/**
 * Given the systems hash of stations and targets, construct a grid of cubes,
 * including the neighboring cubes to search when looking for targets for a
 * given station.
 */
function constructGrid({stations, targets}) {
  const grid = {
    stations: partitionIntoCubes(stations),
    targets: partitionIntoCubes(targets),
  };

  for (let key in grid.stations) {
    const cube = grid.stations[key];
    cube.searchCubes = {};

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const targetKey = [
            cube.key[0] + dx,
            cube.key[1] + dy,
            cube.key[2] + dz
          ];
          if (targetKey in grid.targets) {
            cube.searchCubes[targetKey] = grid.targets[targetKey];
          }
        }
      }
    }
  }

  return grid;
}

/**
 * Given a grid, find the jumpable links from stations to targets and vice
 * versa.
 */
function findLinks(grid) {
  const links = {stations:{}, targets: {}};

  for (let cubeKey in grid.stations) {
    const cube = grid.stations[cubeKey];
    for (let systemName in cube.systems) {
      const system = cube.systems[systemName];
      for (let searchCubeKey in cube.searchCubes) {
        const searchCube = cube.searchCubes[searchCubeKey];
        for (let targetName in searchCube.systems) {
          const target = searchCube.systems[targetName];
          const dx = target.x - system.x;
          const dy = target.y - system.y;
          const dz = target.z - system.z;
          if (dx * dx + dy * dy + dz * dz < MAX_JUMP_DISTANCE_SQ) {
            if (!(systemName in links.stations)) {
              links.stations[systemName] = {from: system, to: {}, count: 0};
            }
            links.stations[systemName].to[targetName] = target;
            links.stations[systemName].count++;

            if (!(targetName in links.targets)) {
              links.targets[targetName] = {to: target, from: {}, count: 0}; 
            }
            links.targets[targetName].from[systemName] = system;
            links.targets[targetName].count++;
          }
        }
      }
    }
  }

  return links;
}

/**
 * Given the links between spaces, and the name of a particular station
 * containing system, find all of the neighboring stations that can jump only
 * to a subset of the targets that this system can jump to, and which have a
 * lesser or equal station rating.
 *
 * In other words, for a given station containing system, find the systems
 * that are made completely redundant by it.
 */
function findRedundantNeighbors(links, systemName) {
  const {from: system, to: targets, count} = links.stations[systemName];

  // First, find the neighboring systems that may be redundant.
  const candidateNeighbors = {};
  for (let targetName in targets) {
    const {from: neighbors} = links.targets[targetName];
    for (let neighborName in neighbors) {
      if (neighborName === systemName || neighborName in candidateNeighbors) {
        continue;
      }
      const {from: neighbor, to: neighborTargets, count: neighborCount} =
          links.stations[neighborName];
      if (neighborCount <= count &&
          neighbor.stationRating <= system.stationRating) {
        candidateNeighbors[neighborName] = neighbor;
      }
    }
  }

  // Now, search through the candidates for the redundancies.
  const redundantNeighbors = {};
  for (let neighborName in candidateNeighbors) {
    const {from: neighbor, to: neighborTargets} = links.stations[neighborName];
    let isRedundant = true;
    for (let neighborTargetName in neighborTargets) {
      if (!(neighborTargetName in targets)) {
        // Can't be redundant, since it links to something this system doesn't.
        isRedundant = false;
        break;
      }
    }
    if (isRedundant) {
      redundantNeighbors[neighborName] = neighbor;
    }
  }

  return redundantNeighbors;
}

/**
 * Given the links between spaces, group similar station containing systems
 * together.
 *
 * A group consists of two kinds of systems: main systems and redundant
 * systems. The main systems in each group can all link to all the targets for
 * that group. There will always be at least one main system in a group.
 *
 * The redundant systems have partial coverage of the targets covered by the
 * group. There may be no redundant systems in a group.
 */
function createStationGroups(links) {
  // Keep track of which systems have been made fully redundant.
  const redundantSystems = {};

  const candidateGroups = {};
  for (let systemName in links.stations) {
    const {from: system, to: targets, count} = links.stations[systemName];
    const group = candidateGroups[systemName] = {
      main: {},
      redundant: {},
      targets,
      count,
      stationRating: system.stationRating,
    };
    group.main[systemName] = system;

    const redundantNeighbors = findRedundantNeighbors(links, systemName);
    for (let neighborName in redundantNeighbors) {
      const {from: neighbor, count: neighborCount} =
          links.stations[neighborName];
      if (neighborCount === count) {
        group.main[neighborName] = neighbor;
      } else {
        group.redundant[neighborName] = neighbor;
        redundantSystems[neighborName] = neighbor;
      }
    }
  }

  // Remove any groups which have been made fully redundant.
  for (let redundantName in redundantSystems) {
    delete candidateGroups[redundantName];
  }

  // Combine cycles (groups with shared multiple main systems).
  const groups = {};
  for (let systemName in candidateGroups) {
    const groupName =
        Object.keys(candidateGroups[systemName].main).sort().join(',');
    groups[groupName] = candidateGroups[systemName];
  }

  return groups;
}

/**
 * Given the determined station system groups, combine any target systems
 * into groups when they have the same station system group coverage. That is,
 * if multiple target systems are all covered by the exact same set of
 * station groups, combine them into one target group.
 */
function combineTargetGroups(stationGroups) {
  // First, for each target determine which station groups can reach it.
  const linkedGroups = {};
  for (let groupName in stationGroups) {
    const {main, targets} = stationGroups[groupName];
    for (let targetName in targets) {
      if (!(targetName in linkedGroups)) {
        linkedGroups[targetName] = {target: targets[targetName], groups: {}};
      }
      linkedGroups[targetName].groups[groupName] = main;
    }
  }

  // Now, map the combination of reachable groups to all the targets.
  const combinableTargets = {};
  for (let targetName in linkedGroups) {
    const {target, groups} = linkedGroups[targetName];
    const combinedGroupNames = Object.keys(groups).sort().join(';');
    if (!(combinedGroupNames in combinableTargets)) {
      combinableTargets[combinedGroupNames] = {groups, targets: {}};
    }
    combinableTargets[combinedGroupNames].targets[targetName] = target;
  }

  // Lastly, use the groups of targets to create a lookup map.
  const targetGroups = {};
  for (let combinedGroupNames in combinableTargets) {
    const {targets} = combinableTargets[combinedGroupNames];
    const targetNames = Object.keys(targets);
    const targetGroup = {
      name: targetNames.join(','),
      count: targetNames.length,
      targets
    };
    for (let targetName in targets) {
      targetGroups[targetName] = targetGroup;
    }
  }

  return targetGroups;
}

/**
 * Given the station system groups and a lookup map for target system groups,
 * construct the graph to be used in the visualization.
 */
function createGraph(stationGroups, targetGroups) {
  const nodes = {};
  const links = {};
  const graph = {nodes: [], links: []};
  for (let groupName in stationGroups) {
    const {targets, count, stationRating} = stationGroups[groupName];

    const stationId = `station:${groupName}`;
    const groupNode = nodes[stationId] = {
      id: stationId,
      name: groupName,
      group: stationRating,
      count,
    };
    graph.nodes.push(groupNode);

    for (let targetName in targets) {
      const targetGroup = targetGroups[targetName];
      const targetId = `target:${targetGroup.name}`;
      if (!(targetId in nodes)) {
        const targetNode = nodes[targetId] = {
          id: targetId,
          name: targetGroup.name,
          group: 0,
          count: targetGroup.count,
        };
        graph.nodes.push(targetNode);
      }

      const link = `${stationId}~${targetId}`;
      if (!(link in links)) {
        links[link] = true;
        graph.links.push({source: stationId, target: targetId});
      }
    }
  }

  return graph;
}

// Read in the data file and perform all processing.
fs.readFile(filename, 'utf-8', (err, rawdata) => {
  if (err) {
    throw err;
  }

  const systems = parseDataIntoSystems(rawdata);

  const grid = constructGrid(systems);

  const links = findLinks(grid);

  const stationGroups = createStationGroups(links);

  const targetGroups = combineTargetGroups(stationGroups);

  const graph = createGraph(stationGroups, targetGroups);

  console.log(JSON.stringify(graph));
});