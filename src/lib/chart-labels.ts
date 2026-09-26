/**
 * ApexCharts writes category and series labels into the DOM with innerHTML
 * (tooltip titles, legends). Labels derived from request data — user agents,
 * protocols — are attacker-chosen, so reduce them to characters that carry no
 * HTML meaning before handing them to a chart.
 */
const UNSAFE_LABEL_CHARS = /[^\p{L}\p{N} ._\-/()+:;,@[\]=]/gu;

export function toSafeChartLabel(value: string): string {
  return value.replace(UNSAFE_LABEL_CHARS, "?");
}
