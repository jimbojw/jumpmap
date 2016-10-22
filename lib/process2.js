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
  const stations = new Set();
  const targets = new Set();

  const lines = rawdata.split('\n');
  for (const line of lines) {
    if (!/\S/.test(line)) {
      continue;
    }

    const system = JSON.parse(line);
    if (system.name in stations || system.name in targets) {
      throw Error(`Duplicate system name: ${system.name}`);
    }

    if (system.stationRating > 2) {
      stations.add(system);
    }

    if (system.securityClass === 'null') {
      targets.add(system);
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
 * Given a Set of systems, partition them into a Map of cubes where the key is
 * a string tuple of x,y,z coordinates. Each cube is an object with a key and
 * set of systems.
 */
function partitionIntoCubes(systems) {
  const cubes = new Map();
  for (const system of systems) {
    const key = getKey(system);
    const k = key + '';
    if (!cubes.has(k)) {
      cubes.set(k, {key, systems: new Set()});
    }
    cubes.get(k).systems.add(system);
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

  for (const [key, cube] of grid.stations) {
    cube.searchCubes = new Set();

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const targetKey = [
            cube.key[0] + dx,
            cube.key[1] + dy,
            cube.key[2] + dz
          ] + '';
          if (grid.targets.has(targetKey)) {
            cube.searchCubes.add(grid.targets.get(targetKey));
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
  const links = {
    // Map of station to Set of reachable targets.
    stations: new Map(),
    // Map of target to Set of stations that can reach it.
    targets: new Map(),
  };

  for (const [key, cube] of grid.stations) {
    for (const system of cube.systems) {
      for (const searchCube of cube.searchCubes) {
        for (const target of searchCube.systems) {
          const dx = target.x - system.x;
          const dy = target.y - system.y;
          const dz = target.z - system.z;
          if (dx * dx + dy * dy + dz * dz < MAX_JUMP_DISTANCE_SQ) {
            if (!links.stations.has(system)) {
              links.stations.set(system, new Set());
            }
            links.stations.get(system).add(target);

            if (!links.targets.has(target)) {
              links.targets.set(target, new Set());
            }
            links.targets.get(target).add(system);
          }
        }
      }
    }
  }

  return links;
}

/**
 * Given the links between spaces, and a particular station containing system,
 * find all of the neighboring stations that can jump only to a subset of the
 * targets that this system can jump to, and which have a lesser or equal
 * station rating.
 *
 * In other words, for a given station containing system, find the systems
 * that are made completely redundant by it.
 */
function findRedundantNeighbors(links, station) {

  // This first pass establishes which neighboring stations may be made fully
  // redundant by the station we're considering. A (possibly empty) subset of
  // these will be the truly redundant neighbors.
  const candidateNeighbors = new Set();
  const targets = links.stations.get(station);
  for (const target of targets) {
    for (const neighbor of links.targets.get(target)) {
      // A neighbor is a station that can reach at least one target that this
      // station can reach.
      if (neighbor.name === station.name || candidateNeighbors.has(neighbor)) {
        continue;
      }

      // A candidate station for redundancy should have less than or equal the
      // number of target systems, and a lesser or equal station rating.
      if (links.stations.get(neighbor).size <= targets.size &&
          neighbor.stationRating <= station.stationRating) {
        candidateNeighbors.add(neighbor);
      }
    }
  }

  // Now we search through the candidates for true redundancies. These will
  // be those systems which can only reach a strict subset of this station's
  // targets.
  const redundantNeighbors = new Set();
  for (const neighbor of candidateNeighbors) {
    let isRedundant = true;
    for (const neighborTarget of links.stations.get(neighbor)) {
      if (!targets.has(neighborTarget)) {
        // This neighbor can't be redundant because it reaches at least one
        // target which this station cannot reach.
        isRedundant = false;
        break;
      }
    }
    if (isRedundant) {
      redundantNeighbors.add(neighbor);
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
  // Keep track of which stations have been made fully redundant. These will be
  // discounted from the final set of groups.
  const redundantStations = new Set();

  // Some groups will be made completely redundant by yet other groups, which
  // is why these are only candidates.
  const candidateGroups = new Map();
  for (const [station, targets] of links.stations) {
    // A group consists of one or more main systems and any number of redundant
    // systems that partially cover the same targets.
    const group = {
      main: new Set([station]),
      redundant: new Set(),
      targets,
      stationRating: station.stationRating,
    };
    candidateGroups.set(station, group);

    const redundantNeighbors = findRedundantNeighbors(links, station);
    for (const neighbor of redundantNeighbors) {
      if (links.stations.get(neighbor).size === targets.size) {
        group.main.add(neighbor);
      } else {
        group.redundant.add(neighbor);
        redundantStations.add(neighbor);
      }
    }
  }

  // Remove redundant stations from candidate groups.
  for (const station of redundantStations) {
    candidateGroups.delete(station);
  }

  // Combine cycles---groups with shared multiple main systems. The station
  // group key here is the concatenation of main system names, and is used
  // later when combining target systems into groups.
  const groups = new Map();
  for (const [station, group] of candidateGroups) {
    const groupKey =
      Array.from(group.main).map(system => system.name).sort().join(',');
    groups.set(groupKey, group);
  }
  return groups;
}

/**
 * Given the Set station groups, combine any target systems into
 * region-specific groups when they have the same station system group
 * coverage. That is, if multiple target systems in the same region are all
 * covered by the exact same set of station groups, combine them into one
 * target group.
 */
function combineTargetGroups(stationGroups) {

  // For each target system, determine which groups can reach it.
  const linkedGroups = new Map();
  for (const [groupKey, group] of stationGroups) {
    for (const target of group.targets) {
      if (!linkedGroups.has(target)) {
        linkedGroups.set(target, new Map());
      }
      linkedGroups.get(target).set(groupKey, group);
    }
  }

  // Now, map the combination of reachable groups to all the target, separating
  // them out by region.
  const combinableTargetsByRegion = new Map();
  for (const [target, groups] of linkedGroups) {
    if (!combinableTargetsByRegion.has(target.region)) {
      combinableTargetsByRegion.set(target.region, new Map());
    }
    const combinableTargets = combinableTargetsByRegion.get(target.region);

    const combinedGroupKey = Array.from(groups.keys()).sort().join(';');
    if (!combinableTargets.has(combinedGroupKey)) {
      combinableTargets.set(combinedGroupKey, new Set());
    }
    combinableTargets.get(combinedGroupKey).add(target);
  }

  // Lastly, use the groups of targets by region to create a lookup map.
  const targetGroups = new Map();
  for (const [region, combinableTargets] of combinableTargetsByRegion) {
    for (const [combinedGroupKey, targets] of combinableTargets) {
      const targetGroup = {
        region,
        name: Array.from(targets).map(system => system.name).sort().join(', '),
        targets,
      };
      for (const target of targets) {
        targetGroups.set(target, targetGroup);
      }
    }
  }

  return targetGroups;
}

/**
 * Given the station groups and a lookup map for target system groups,
 * construct the graph to be used in the visualization.
 */
function createGraph(stationGroups, targetGroups) {

  const nodes = new Map();
  const links = new Map();

  for (const [stationGroupKey, stationGroup] of stationGroups) {
    // Add a node to the graph for this group of stations.
    const stationId = `station:${stationGroupKey}`;
    const redundancies = Array.from(stationGroup.redundant)
        .map(station => station.name).sort().join(', ') || '<none>';
    const stationGroupNode = {
      id: stationId,
      name: `main: ${stationGroupKey}\nredundant: ${redundancies}`,
      stationRating: stationGroup.stationRating,
      count: stationGroup.targets.size,
    };
    nodes.set(stationId, stationGroupNode);

    // For each target of this group, make sure its target group is added and
    // a link exists as well.
    for (const target of stationGroup.targets) {
      const targetGroup = targetGroups.get(target);
      const targetId = `target:${targetGroup.name}`;
      if (!nodes.has(targetId)) {
        nodes.set(targetId, {
          id: targetId,
          name: `(${targetGroup.region}) ${targetGroup.name}`,
          region: targetGroup.region,
          count: targetGroup.targets.size,
        });
      }

      const link = `${stationId}~${targetId}`;
      if (!links.has(link)) {
        links.set(link, {source: stationId, target: targetId});
      }
    }
  }

  return {
    nodes: Array.from(nodes.values()),
    links: Array.from(links.values()),
  };
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
