const rect = document.body.getBoundingClientRect();

const svg = d3.select('svg')
    .attr('width', rect.width)
    .attr('height', rect.height);

const container = svg.append('g');

const color = d3.scaleOrdinal(d3.schemeCategory20);

var simulation = d3.forceSimulation()
    .force("link", d3.forceLink().id(function(d) { return d.id; }))
    .force("charge", d3.forceManyBody()
        .strength(node => -1 * (10 + node.count)))
    .force("center", d3.forceCenter(rect.width / 2, rect.height / 2))
    .force("x", d3.forceX(rect.width / 2).strength(0.03))
    .force("y", d3.forceY(rect.height / 2).strength(0.03));

svg.call(d3.zoom()
    .scaleExtent([0.2, 4])
    .on('zoom', () => container.attr('transform', d3.event.transform)));

d3.json("eve.json", function(error, graph) {
  if (error) throw error;

  var link = container.append("g")
      .attr("class", "links")
    .selectAll("line")
    .data(graph.links)
    .enter().append("line")
      .attr("stroke-width", 1);

  var node = container.append("g")
      .attr("class", "nodes")
    .selectAll("circle")
    .data(graph.nodes)
    .enter().append("circle")
    .attr("r", d => 1 + Math.sqrt(d.count))
    .attr("fill", d => d.region ? color(d.region) : '#ccc')
      .on('mouseover', function(d) {
        const id = d.id;
        link
          .filter(d => d.source.id === id || d.target.id === id)
          .style('stroke', 'red')
          .style('stroke-opacity', '0.7');
      })
      .on('mouseout', function(d) {
        const id = d.id;
        link
          .filter(d => d.source.id === id || d.target.id === id)
          .style('stroke', null)
          .style('stroke-opacity', null);
      })
      .call(d3.drag()
          .on("start", dragstarted)
          .on("drag", dragged)
          .on("end", dragended));

  node.append("title").text(d => d.name);

  simulation
      .nodes(graph.nodes)
      .on("tick", ticked);

  simulation.force("link")
      .links(graph.links);

  function ticked() {
    link
        .attr("x1", function(d) { return d.source.x; })
        .attr("y1", function(d) { return d.source.y; })
        .attr("x2", function(d) { return d.target.x; })
        .attr("y2", function(d) { return d.target.y; });

    node
        .attr("cx", function(d) { return d.x; })
        .attr("cy", function(d) { return d.y; });
  }
});

function dragstarted(d) {
  if (!d3.event.active) simulation.alphaTarget(0.3).restart();
  d.fx = d.x;
  d.fy = d.y;
}

function dragged(d) {
  d.fx = d3.event.x;
  d.fy = d3.event.y;
}

function dragended(d) {
  if (!d3.event.active) simulation.alphaTarget(0);
  d.fx = null;
  d.fy = null;
}
