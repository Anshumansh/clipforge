declare module "parse-prometheus-text-format" {
  interface PrometheusSample {
    labels: Record<string, string>;
    value: string;
    timestamp_ms?: string;
  }

  interface PrometheusMetricFamily {
    name: string;
    help: string;
    type: "GAUGE" | "COUNTER" | "SUMMARY" | "HISTOGRAM" | "UNTYPED";
    metrics: PrometheusSample[];
  }

  function parsePrometheusTextFormat(text: string): PrometheusMetricFamily[];
  export = parsePrometheusTextFormat;
}
