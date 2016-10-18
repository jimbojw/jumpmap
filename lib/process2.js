'use strict';

const fs = require('fs');
const filename = process.argv[2];

if (!filename) {
  throw Error('No filename provided');
}

const seven = 6.622512e+16;  // 7 lightyears in meters.
const seven2 = seven * seven;

/**
 * Given the raw input data, create a hash of all systems.
 */
function parseDataIntoSystems(rawdata) {
  const systems = {};
  const lines = rawdata.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/\S/.test(line)) {
      continue;
    }
    const system = JSON.parse(line);
    if (system.name in systems) {
      throw Error(`Duplicate system name: ${system.name}`);
    } else if (system.securityClass === 'low' && system.stationRating < 3) {
      continue;
    }
    systems[system.name] = system;
  }
  return systems;
}

/**
 * Given a system, return a key for looking it up in the grid.
 */
function getKey(system) {
  return [
    Math.floor(system.x / seven),
    Math.floor(system.y / seven),
    Math.floor(system.z / seven),
  ];
}

/**
 * Given the systems hash, construct a grid of cubes.
 */
function constructGrid(systems) {
  const grid = {};

  for (let name in systems) {
    const system = systems[name];

    if (!(system.securityClass in grid)) {
      grid[system.securityClass] = {};
    }
    const cubes = grid[system.securityClass];

    const key = getKey(system);
    if (!(key in cubes)) {
      cubes[key] = {key, systems: {}};
    }
    cubes[key].systems[system.name] = system;
  }

  computeSearchCubes(grid);

  return grid;
}

/**
 * Given a grid of low and null security space cubes, for each cube
 * containing any low security spaces, find the neighboring cubes to search
 * for nulls.
 */
function computeSearchCubes(grid) {
  for (let key in grid.low) {
    const cube = grid.low[key];
    cube.searchCubes = {};

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const otherKey = [
            cube.key[0] + dx,
            cube.key[1] + dy,
            cube.key[2] + dz
          ];
          if (otherKey in grid.null) {
            cube.searchCubes[otherKey] = grid.null[otherKey];
          }
        }
      }
    }
  }
}

/**
 * Given a grid, find the jumpable links between low-sec to null-sec spaces.
 */
function findLinks(grid) {
  const links = {low:{}, null: {}};

  for (let cubeKey in grid.low) {
    const cube = grid.low[cubeKey];
    for (let systemName in cube.systems) {
      const system = cube.systems[systemName];
      for (let searchCubeKey in cube.searchCubes) {
        const searchCube = cube.searchCubes[searchCubeKey];
        for (let targetName in searchCube.systems) {
          const target = searchCube.systems[targetName];
          const dx = target.x - system.x;
          const dy = target.y - system.y;
          const dz = target.z - system.z;
          if (dx * dx + dy * dy + dz * dz < seven2) {
            if (!(systemName in links.low)) {
              links.low[systemName] = {from: system, to: {}, count: 0};
            }
            links.low[systemName].to[targetName] = target;
            links.low[systemName].count++;

            if (!(targetName in links.null)) {
              links.null[targetName] = {to: target, from: {}, count: 0}; 
            }
            links.null[targetName].from[systemName] = system;
            links.null[targetName].count++;
          }
        }
      }
    }
  }

  return links;
}

/**
 * Given the links between spaces, and the name of a low-sec system, find all
 * of the neighboring low-sec spaces that can jump only to a subset of the
 * nulls that this system can jump to.
 */
function findRedundantNeighbors(links, systemName) {
  const {from: system, to: targets, count} = links.low[systemName];

  // First, find the neighboring systems that may be redundant.
  const candidateNeighbors = {};
  for (let targetName in targets) {
    const {from: neighbors} = links.null[targetName];
    for (let neighborName in neighbors) {
      if (neighborName === systemName || neighborName in candidateNeighbors) {
        continue;
      }
      const {from: neighbor, to: neighborTargets, count: neighborCount} =
          links.low[neighborName];
      if (neighborCount <= count) {
        candidateNeighbors[neighborName] = neighbor;
      }
    }
  }

  // Now, search through the candidates for the redundancies.
  const redundantNeighbors = {};
  for (let neighborName in candidateNeighbors) {
    const {from: neighbor, to: neighborTargets} = links.low[neighborName];
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
 * Given the links between spaces, group similar low-sec systems together.
 * A group consists of two kinds of systems: main and redundant. The main
 * systems in each group can all link to all the nulls for that group. There
 * will always be at least one main system in a group.
 *
 * The redundant systems have partial coverage of the nulls covered by the
 * group. There may be no redundant systems.
 */
function createSystemGroups(links) {
  // Keep track of which systems have been made fully redundant.
  const redundantSystems = {};

  const candidateGroups = {};
  for (let systemName in links.low) {
    const {from: system, to: targets, count} = links.low[systemName];
    const group = candidateGroups[systemName] = {
      main: {},
      redundant: {},
      targets,
      count
    };
    group.main[systemName] = system;

    const redundantNeighbors = findRedundantNeighbors(links, systemName);
    for (let neighborName in redundantNeighbors) {
      const {from: neighbor, count: neighborCount} = links.low[neighborName];
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
 * Given the determined low-sec system groups, combine any null-sec systems
 * into groups when they have the same low-sec system group coverage. That is,
 * if multiple null-sec systems are all covered by the exact same set of
 * low-sec groups, combine them into one null-sec group.
 */
function combineTargetGroups(systemGroups) {
  // First, for each target (null-sec group), determine which low-sec groups
  // can reach it.
  const linkedGroups = {};
  for (let groupName in systemGroups) {
    const {main, targets} = systemGroups[groupName];
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
 * Given the low-sec system groups and a lookup map for target null-sec groups,
 * construct the graph to be used in the visualization.
 */
function createGraph(systemGroups, targetGroups) {
  const nodes = {};
  const links = {};
  const graph = {nodes: [], links: []};
  for (let groupName in systemGroups) {
    const {targets, count} = systemGroups[groupName];
    const groupNode = nodes[groupName] = {
      id: groupName,
      group: 1,
      count,
    };
    graph.nodes.push(groupNode);

    for (let targetName in targets) {
      const targetGroup = targetGroups[targetName];
      if (!(targetGroup.name in nodes)) {
        const targetNode = nodes[targetGroup.name] = {
          id: targetGroup.name,
          group: 0,
          count: targetGroup.count,
        };
        graph.nodes.push(targetNode);
      }

      const link = `${groupName}~${targetGroup.name}`;
      if (!(link in links)) {
        links[link] = true;
        graph.links.push({source: groupName, target: targetGroup.name});
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

  const systemGroups = createSystemGroups(links);

  const targetGroups = combineTargetGroups(systemGroups);

  const graph = createGraph(systemGroups, targetGroups);

  console.log(JSON.stringify(graph));
});
