
import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

interface EnergyCurveProps {
  energy: number;
}

const EnergyCurve: React.FC<EnergyCurveProps> = ({ energy }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = 800;
    const height = 150;
    const margin = { top: 30, right: 30, bottom: 20, left: 30 };

    const data: [number, number][] = [
      [0, 15], [3, 25], [6, 45], [9, energy * 25], 
      [12, energy * 28], [15, energy * 18], [18, energy * 22], 
      [21, 30], [24, 10]
    ];

    const x = d3.scaleLinear().domain([0, 24]).range([margin.left, width - margin.right]);
    const y = d3.scaleLinear().domain([0, 150]).range([height - margin.bottom, margin.top]);

    const line = d3.line()
      .x(d => x(d[0]))
      .y(d => y(d[1]))
      .curve(d3.curveBasis);

    const area = d3.area()
      .x(d => x(d[0]))
      .y1(d => y(d[1]))
      .y0(height - margin.bottom)
      .curve(d3.curveBasis);

    // Gradient
    const gradient = svg.append("defs")
      .append("linearGradient")
      .attr("id", "soul-gradient")
      .attr("x1", "0%").attr("y1", "0%")
      .attr("x2", "0%").attr("y2", "100%");

    gradient.append("stop")
      .attr("offset", "0%")
      .attr("stop-color", "#7DF9FF")
      .attr("stop-opacity", 0.3);

    gradient.append("stop")
      .attr("offset", "100%")
      .attr("stop-color", "#8A2BE2")
      .attr("stop-opacity", 0);

    // Filter for glow
    const filter = svg.append("defs")
      .append("filter")
      .attr("id", "glow");
    filter.append("feGaussianBlur")
      .attr("stdDeviation", "3.5")
      .attr("result", "coloredBlur");
    const feMerge = filter.append("feMerge");
    feMerge.append("feMergeNode").attr("in", "coloredBlur");
    feMerge.append("feMergeNode").attr("in", "SourceGraphic");

    svg.append("path")
      .datum(data)
      .attr("fill", "url(#soul-gradient)")
      .attr("d", area as any);

    svg.append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", "#7DF9FF")
      .attr("stroke-width", 3)
      .attr("filter", "url(#glow)")
      .attr("d", line as any);

    // Dots for specific points
    svg.selectAll(".dot")
      .data(data)
      .enter().append("circle")
      .attr("cx", d => x(d[0]))
      .attr("cy", d => y(d[1]))
      .attr("r", 3)
      .attr("fill", "#FFBF00")
      .attr("opacity", 0.6);

  }, [energy]);

  return (
    <div className="w-full overflow-hidden flex justify-center py-2">
      <svg ref={svgRef} viewBox="0 0 800 150" className="w-full max-w-3xl h-auto" />
    </div>
  );
};

export default EnergyCurve;
