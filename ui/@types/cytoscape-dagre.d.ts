declare module "cytoscape-dagre" {
  import cytoscape from "cytoscape";
  const dagre: cytoscape.Ext;
  export default dagre;
}

declare module "dagre" {
  export interface Graph {
    setDefaultEdgeLabel(callback: () => unknown): void;
    setNode(id: string, value: unknown): void;
    setEdge(source: string, target: string, value?: unknown): void;
    nodes(): string[];
    edges(): Array<{ v: string; w: string }>;
  }
  
  export function graph(): Graph;
  export function layout(graph: Graph): void;
}
