export type SupportedChartKind = "line" | "bar" | "area";

export interface SupportedChartPoint {
  x: string | number;
  y: number;
}

export interface SupportedChartSeries {
  name: string | null;
  points: SupportedChartPoint[];
}

export interface SupportedChartSpec {
  kind: SupportedChartKind;
  title: string | null;
  xLabel: string | null;
  yLabel: string | null;
  xType: "number" | "string";
  series: SupportedChartSeries[];
  source: "simple-series" | "vega-lite-subset";
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeChartKind(value: unknown): SupportedChartKind | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.toLowerCase();
  return normalized === "line" || normalized === "bar" || normalized === "area"
    ? normalized
    : null;
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePoint(value: unknown): SupportedChartPoint | null {
  if (!isRecord(value)) {
    return null;
  }

  const x = value.x;
  const y = value.y;

  if (!(typeof x === "string" || typeof x === "number")) {
    return null;
  }

  if (typeof y !== "number" || !Number.isFinite(y)) {
    return null;
  }

  return { x, y };
}

function normalizeSeriesList(
  value: unknown
): { series: SupportedChartSeries[]; xType: "number" | "string" } | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const series: SupportedChartSeries[] = [];
  let sawNumberX = false;
  let sawStringX = false;

  for (const entry of value) {
    if (!isRecord(entry)) {
      return null;
    }

    const pointsValue = Array.isArray(entry.points) ? entry.points : entry.values;
    if (!Array.isArray(pointsValue) || pointsValue.length === 0) {
      return null;
    }

    const points: SupportedChartPoint[] = [];
    for (const pointValue of pointsValue) {
      const point = normalizePoint(pointValue);
      if (!point) {
        return null;
      }
      if (typeof point.x === "number") {
        sawNumberX = true;
      } else {
        sawStringX = true;
      }
      points.push(point);
    }

    series.push({
      name: normalizeString(entry.name) ?? normalizeString(entry.label),
      points,
    });
  }

  return {
    series,
    xType: sawStringX || !sawNumberX ? "string" : "number",
  };
}

function parseSimpleSeriesSpec(value: unknown): SupportedChartSpec | null {
  if (!isRecord(value)) {
    return null;
  }

  const kind = normalizeChartKind(value.kind ?? value.type ?? value.chart);
  if (!kind) {
    return null;
  }

  const normalizedSeries = normalizeSeriesList(value.series);
  if (!normalizedSeries) {
    return null;
  }

  return {
    kind,
    title: normalizeString(value.title),
    xLabel: normalizeString(value.xLabel),
    yLabel: normalizeString(value.yLabel),
    xType: normalizedSeries.xType,
    series: normalizedSeries.series,
    source: "simple-series",
  };
}

function normalizeVegaLiteMark(value: unknown): SupportedChartKind | null {
  if (typeof value === "string") {
    return normalizeChartKind(value);
  }

  if (isRecord(value)) {
    return normalizeChartKind(value.type);
  }

  return null;
}

function normalizeVegaLiteField(
  value: unknown
): { field: string; title: string | null } | null {
  if (!isRecord(value) || typeof value.field !== "string" || !value.field.trim()) {
    return null;
  }

  return {
    field: value.field,
    title: normalizeString(value.title),
  };
}

function parseVegaLiteSubset(value: unknown): SupportedChartSpec | null {
  if (!isRecord(value)) {
    return null;
  }

  if (value.transform !== undefined || value.params !== undefined || value.datasets !== undefined) {
    return null;
  }

  const kind = normalizeVegaLiteMark(value.mark);
  if (!kind) {
    return null;
  }

  if (!isRecord(value.data) || !Array.isArray(value.data.values) || value.data.url !== undefined) {
    return null;
  }

  if (!isRecord(value.encoding)) {
    return null;
  }

  const xField = normalizeVegaLiteField(value.encoding.x);
  const yField = normalizeVegaLiteField(value.encoding.y);
  if (!xField || !yField) {
    return null;
  }

  const colorField = normalizeVegaLiteField(value.encoding.color);
  const grouped = new Map<string, SupportedChartPoint[]>();
  let sawNumberX = false;
  let sawStringX = false;

  for (const row of value.data.values) {
    if (!isRecord(row)) {
      return null;
    }

    const xValue = row[xField.field];
    const yValue = row[yField.field];
    if (!(typeof xValue === "string" || typeof xValue === "number")) {
      return null;
    }
    if (typeof yValue !== "number" || !Number.isFinite(yValue)) {
      return null;
    }

    if (typeof xValue === "number") {
      sawNumberX = true;
    } else {
      sawStringX = true;
    }

    const seriesName =
      colorField && typeof row[colorField.field] === "string"
        ? (row[colorField.field] as string)
        : "Series 1";

    const points = grouped.get(seriesName) ?? [];
    points.push({ x: xValue, y: yValue });
    grouped.set(seriesName, points);
  }

  if (grouped.size === 0) {
    return null;
  }

  const series = Array.from(grouped.entries()).map(([name, points]) => ({
    name,
    points,
  }));

  return {
    kind,
    title: normalizeString(value.title),
    xLabel: xField.title ?? xField.field,
    yLabel: yField.title ?? yField.field,
    xType: sawStringX || !sawNumberX ? "string" : "number",
    series,
    source: "vega-lite-subset",
  };
}

export function parseSupportedChartSpec(value: unknown): SupportedChartSpec | null {
  return parseSimpleSeriesSpec(value) ?? parseVegaLiteSubset(value);
}
