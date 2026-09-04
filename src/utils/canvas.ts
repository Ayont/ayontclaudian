import { escapePromptXmlAttribute, escapePromptXmlClosingTags } from "./promptXml";

export interface CanvasNodeData {
  id: string;
  type: string;
  text?: string;
  file?: string;
  url?: string;
}

export interface CanvasEdgeData {
  id: string;
  fromNode: string;
  toNode: string;
  label?: string;
}

export interface CanvasSelectionContext {
  canvasPath: string;
  nodeIds: string[];
  nodes?: CanvasNodeData[];
  edges?: CanvasEdgeData[];
}

export function formatCanvasContext(context: CanvasSelectionContext): string {
  if (context.nodeIds.length === 0 && (!context.nodes || context.nodes.length === 0)) return "";

  const lines: string[] = [];
  lines.push(`<canvas_selection path="${escapePromptXmlAttribute(context.canvasPath)}">`);

  if (context.nodes && context.nodes.length > 0) {
    for (const node of context.nodes) {
      if (node.type === "text" && node.text) {
        lines.push(`  <node id="${escapePromptXmlAttribute(node.id)}" type="text">`);
        lines.push(`    ${escapePromptXmlClosingTags(node.text, "node")}`);
        lines.push("  </node>");
      } else if (node.type === "file" && node.file) {
        lines.push(`  <node id="${escapePromptXmlAttribute(node.id)}" type="file" path="${escapePromptXmlAttribute(node.file)}" />`);
      } else if (node.type === "link" && node.url) {
        lines.push(`  <node id="${escapePromptXmlAttribute(node.id)}" type="link" url="${escapePromptXmlAttribute(node.url)}" />`);
      } else {
        lines.push(`  <node id="${escapePromptXmlAttribute(node.id)}" type="${escapePromptXmlAttribute(node.type || "unknown")}" />`);
      }
    }
  } else {
    lines.push(escapePromptXmlClosingTags(context.nodeIds.join(", "), "canvas_selection"));
  }

  if (context.edges && context.edges.length > 0) {
    for (const edge of context.edges) {
      const labelAttr = edge.label ? ` label="${escapePromptXmlAttribute(edge.label)}"` : "";
      lines.push(`  <edge from="${escapePromptXmlAttribute(edge.fromNode)}" to="${escapePromptXmlAttribute(edge.toNode)}"${labelAttr} />`);
    }
  }

  lines.push("</canvas_selection>");
  return lines.join("\n");
}

export function appendCanvasContext(prompt: string, context: CanvasSelectionContext): string {
  const formatted = formatCanvasContext(context);
  return formatted ? `${prompt}\n\n${formatted}` : prompt;
}
