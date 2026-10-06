import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi, truncateToWidth, sliceByColumn } from "@earendil-works/pi-tui";
import { ansiStyle } from "./ansi.js";
import { resolvePreset } from "./presets/index.js";
import type { BlockColors, PowerlinePreset } from "./presets/types.js";
import {
  LINE_BREAK_SEGMENT_NAME,
  type PalettePreset,
  type PowerlineBlockName,
  type RenderItem,
  type RenderSegment,
  type SegmentPalette,
  type SeparatorName,
  type StatuslineConfig,
} from "./types.js";

interface PowerlineBlock {
  baseBlock: PowerlineBlockName;
  colors: BlockColors;
  segments: RenderSegment[];
}

export function renderPowerlineStatusline(
  width: number,
  items: RenderItem[],
  config: Pick<StatuslineConfig, "palettePreset" | "palette" | "density" | "separator">,
  trueColor = true,
): string {
  if (items.length === 0 || width <= 0) return "";
  return splitLines(items)
    .map((segments) => wrapPowerlineSegments(segments, width, config, trueColor))
    .join("\n");
}

function splitLines(items: RenderItem[]): RenderSegment[][] {
  const lines: RenderSegment[][] = [[]];
  for (const item of items) {
    if (item.name === LINE_BREAK_SEGMENT_NAME) lines.push([]);
    else lines.at(-1)?.push(item);
  }
  return lines;
}

function wrapPowerlineSegments(
  segments: readonly RenderSegment[],
  width: number,
  config: Pick<StatuslineConfig, "palettePreset" | "palette" | "density" | "separator">,
  trueColor: boolean,
): string {
  if (segments.length === 0) return "";
  const render = (items: readonly RenderSegment[]) => joinPowerlineSegments([...items], config, trueColor);
  const fits = (items: readonly RenderSegment[]) => visibleWidth(render(items)) <= width;
  if (fits(segments)) return render(segments);

  // Prefer a balanced two-row split, preserving configured order and every segment.
  let split = -1;
  let balance = Infinity;
  for (let index = 1; index < segments.length; index++) {
    const left = segments.slice(0, index);
    const right = segments.slice(index);
    if (!fits(left) || !fits(right)) continue;
    const difference = Math.abs(visibleWidth(render(left)) - visibleWidth(render(right)));
    if (difference < balance) { split = index; balance = difference; }
  }
  if (split > 0) return `${render(segments.slice(0, split))}\n${render(segments.slice(split))}`;

  // Split within oversized fields if necessary, without repeating decoration.
  // Extremely narrow terminals may need more rows; never silently drop a field.
  const full = render(segments);
  const wrapped = wrapTextWithAnsi(full, width);
  if (wrapped.length <= 2 || visibleWidth(full) > width * 2) {
    return wrapped.map(line => truncateToWidth(line, width, "")).join("\n");
  }
  // Word wrapping can waste a row before a long unbroken path. Fill columns
  // instead, carrying ANSI state and keeping wide graphemes intact.
  const lines: string[] = [];
  for (let column = 0; column < visibleWidth(full);) {
    const part = sliceByColumn(full, column, width, true);
    lines.push(`${part}\x1b[0m\x1b]8;;\x07`);
    column += visibleWidth(part) || width;
  }
  return lines.join("\n");
}

export function powerlineExtensionSeparator(
  _theme: Theme,
  palettePreset: PalettePreset = "tokyo-night",
  trueColor = true,
): string {
  return ansiStyle(" • ", { fg: resolvePreset(palettePreset).extensionSeparator }, trueColor);
}

function joinPowerlineSegments(
  segments: RenderSegment[],
  config: Pick<StatuslineConfig, "palettePreset" | "palette" | "density" | "separator">,
  trueColor: boolean,
): string {
  const preset = resolvePreset(config.palettePreset);
  const blocks = contiguousBlocks(segments, preset, config.palettePreset, config.palette);
  let line = ansiStyle("░▒▓", { fg: preset.lead }, trueColor);

  for (const [index, block] of blocks.entries()) {
    const previous = index === 0 ? undefined : blocks[index - 1]?.colors;
    if (previous) {
      line += ansiStyle("", { fg: previous.bg, bg: block.colors.bg }, trueColor);
    }
    line += ansiStyle(formatBlockText(block, config), block.colors, trueColor);
  }

  const lastBlock = blocks.at(-1);
  if (lastBlock) line += ansiStyle("", { fg: lastBlock.colors.bg }, trueColor);
  return line;
}

function contiguousBlocks(
  segments: RenderSegment[],
  preset: PowerlinePreset,
  palettePreset: PalettePreset,
  configuredPalette: SegmentPalette,
): PowerlineBlock[] {
  const blocks: PowerlineBlock[] = [];
  const usesConfiguredColors = palettePreset === "custom";
  for (const segment of segments) {
    const colors = usesConfiguredColors ? (configuredPalette[segment.name] ?? {}) : preset.blocks[segment.block];
    const previous = blocks.at(-1);
    const matchesPrevious =
      previous !== undefined &&
      (usesConfiguredColors ? colorsEqual(previous.colors, colors) : previous.baseBlock === segment.block);
    if (matchesPrevious) previous.segments.push(segment);
    else blocks.push({ baseBlock: segment.block, colors, segments: [segment] });
  }
  return blocks;
}

function colorsEqual(left: BlockColors, right: BlockColors): boolean {
  return left.fg === right.fg && left.bg === right.bg;
}

function formatBlockText(block: PowerlineBlock, config: Pick<StatuslineConfig, "density" | "separator">): string {
  const texts = block.segments.map(formatSegmentText);
  const separator = separatorText(config.separator, config.density === "cozy");
  const leading = config.density === "cozy" ? "  " : " ";
  const trailing = config.density === "cozy" ? " " : "";
  return `${leading}${texts.join(separator)}${trailing}`;
}

function formatSegmentText(segment: RenderSegment): string {
  return segment.emphasis ? `\u001b[1m${segment.text}\u001b[22m` : segment.text;
}

function separatorText(separator: SeparatorName, cozy: boolean): string {
  const padding = cozy ? "  " : " ";
  switch (separator) {
    case "dot":
      return `${padding}•${padding}`;
    case "bar":
      return `${padding}│${padding}`;
    case "powerline":
      return `${padding}${padding}`;
    case "round":
      return `${padding}❯${padding}`;
    case "none":
      return padding;
  }
}
