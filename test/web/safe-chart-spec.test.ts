import test from "node:test";
import assert from "node:assert/strict";

import { parseSupportedChartSpec } from "../../web/src/domains/run/lib/safe-chart-spec.js";

test("parseSupportedChartSpec supports the simple series chart format", () => {
  const parsed = parseSupportedChartSpec({
    kind: "line",
    title: "Revenue",
    xLabel: "Month",
    yLabel: "Value",
    series: [
      {
        name: "North",
        points: [
          { x: "Jan", y: 10 },
          { x: "Feb", y: 15 },
        ],
      },
    ],
  });

  assert.deepEqual(parsed, {
    kind: "line",
    title: "Revenue",
    xLabel: "Month",
    yLabel: "Value",
    xType: "string",
    series: [
      {
        name: "North",
        points: [
          { x: "Jan", y: 10 },
          { x: "Feb", y: 15 },
        ],
      },
    ],
    source: "simple-series",
  });
});

test("parseSupportedChartSpec supports a safe Vega-Lite subset", () => {
  const parsed = parseSupportedChartSpec({
    title: "Velocity",
    mark: "bar",
    data: {
      values: [
        { sprint: "S1", points: 18, team: "A" },
        { sprint: "S1", points: 12, team: "B" },
      ],
    },
    encoding: {
      x: { field: "sprint", title: "Sprint" },
      y: { field: "points", title: "Points" },
      color: { field: "team" },
    },
  });

  assert.deepEqual(parsed, {
    kind: "bar",
    title: "Velocity",
    xLabel: "Sprint",
    yLabel: "Points",
    xType: "string",
    series: [
      {
        name: "A",
        points: [{ x: "S1", y: 18 }],
      },
      {
        name: "B",
        points: [{ x: "S1", y: 12 }],
      },
    ],
    source: "vega-lite-subset",
  });
});

test("parseSupportedChartSpec rejects unsupported or unsafe chart specs", () => {
  assert.equal(
    parseSupportedChartSpec({
      mark: "line",
      data: { url: "https://example.com/data.json" },
      encoding: {
        x: { field: "x" },
        y: { field: "y" },
      },
    }),
    null
  );

  assert.equal(
    parseSupportedChartSpec({
      mark: "circle",
      data: { values: [{ x: 1, y: 2 }] },
      encoding: {
        x: { field: "x" },
        y: { field: "y" },
      },
    }),
    null
  );

  assert.equal(
    parseSupportedChartSpec({
      kind: "line",
      series: [
        {
          name: "broken",
          points: [{ x: "Jan", y: "bad" }],
        },
      ],
    }),
    null
  );
});
