'use client';

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { api, ResearchGraphDTO, RelatedPaperDTO, GraphNodeDTO, GraphEdgeDTO, GraphClusterDTO } from '../../lib/api';
import { useProject } from '../../context/ProjectContext';
import { t } from '../../i18n';
import { Tooltip, TooltipTrigger, TooltipContent } from '@openresearch/ui';
import { ViewHeader } from '../shell/ViewHeader';
import {
  Share2,
  BookOpen,
  User,
  Tag,
  Sparkles,
  ExternalLink,
  Search,
  Filter,
  Layers,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Plus,
  Compass,
  ArrowRight,
  ShieldCheck,
  Quote,
  Check
} from 'lucide-react';

interface ResearchGraphViewProps {
  onOpenReader?: (paperId: string) => void;
  onAskChat?: (paperId: string, prompt?: string) => void;
  onCite?: (paperId: string) => void;
  onAddToLibrary: (rec: RelatedPaperDTO) => Promise<void>;
}

export const ResearchGraphView: React.FC<ResearchGraphViewProps> = ({
  onOpenReader,
  onAskChat,
  onCite,
  onAddToLibrary,
}) => {
  const { activeProject } = useProject();
  const [graphData, setGraphData] = useState<ResearchGraphDTO | null>(null);
  const [recommendations, setRecommendations] = useState<RelatedPaperDTO[]>([]);
  const [selectedNode, setSelectedNode] = useState<GraphNodeDTO | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'paper' | 'author' | 'topic'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [addedRecIds, setAddedRecIds] = useState<string[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);

  const handleAddToLibrary = async (rec: RelatedPaperDTO) => {
    if (addedRecIds.includes(rec.id)) return;
    await onAddToLibrary(rec);
    setAddedRecIds((prev) => [...prev, rec.id]);
    setTimeout(() => {
      setAddedRecIds((prev) => prev.filter((id) => id !== rec.id));
    }, 2000);
  };

  const loadGraph = useCallback(async () => {
    if (!activeProject) return;
    setIsLoading(true);
    try {
      const [gData, recs] = await Promise.all([
        api.graphs.getResearchGraph(activeProject.id),
        api.graphs.discoverRelated(activeProject.id),
      ]);
      setGraphData(gData);
      setRecommendations(recs);
      if (gData.nodes.length > 0) {
        setSelectedNode(gData.nodes[0] || null);
      }
    } catch (err) {
      console.warn('Could not load research graph', err);
    } finally {
      setIsLoading(false);
    }
  }, [activeProject]);

  useEffect(() => {
    loadGraph();
  }, [activeProject, loadGraph]);

  // Compute 2D layout positions for nodes
  const layoutNodes = useMemo<GraphNodeDTO[]>(() => {
    if (!graphData || !graphData.nodes) return [];
    const nodes = graphData.nodes;
    const total = nodes.length;
    const centerX = 350;
    const centerY = 260;
    const radius = Math.min(220, 100 + total * 15);

    return nodes.map((node: GraphNodeDTO, idx: number) => {
      const angle = (idx / total) * 2 * Math.PI;
      // Add slight offset based on cluster_id or degree
      const clusterOffset = (node.cluster_id || 1) * 15;
      const r = node.type === 'paper' ? radius : radius * 0.75 + clusterOffset;
      const x = centerX + r * Math.cos(angle);
      const y = centerY + r * Math.sin(angle);
      return {
        ...node,
        x,
        y,
      };
    });
  }, [graphData]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, GraphNodeDTO>();
    layoutNodes.forEach((n: GraphNodeDTO) => map.set(n.id, n));
    return map;
  }, [layoutNodes]);

  const filteredNodes = useMemo(() => {
    return layoutNodes.filter((n: GraphNodeDTO) => {
      if (filterType !== 'all' && n.type !== filterType) return false;
      if (searchQuery.trim()) {
        return n.label.toLowerCase().includes(searchQuery.toLowerCase());
      }
      return true;
    });
  }, [layoutNodes, filterType, searchQuery]);

  const visibleNodeIds = useMemo(() => {
    return new Set(filteredNodes.map((n: GraphNodeDTO) => n.id));
  }, [filteredNodes]);

  const filteredEdges = useMemo(() => {
    if (!graphData || !graphData.edges) return [];
    return graphData.edges.filter(
      (e: GraphEdgeDTO) => visibleNodeIds.has(e.source) && visibleNodeIds.has(e.target)
    );
  }, [graphData, visibleNodeIds]);

  return (
    <div className="flex flex-col h-full overflow-hidden bg-canvas">
      {/* Top Header & Metrics Bar */}
      <ViewHeader
        icon={<Share2 className="w-5 h-5" />}
        title={t('researchGraph.title')}
        subtitle={t('researchGraph.subtitle')}
        actions={
          graphData && (
            <div className="flex items-center gap-3">
              <div className="px-3 py-1.5 rounded-lg border border-border-default bg-surface text-xs flex items-center gap-2">
                <BookOpen className="w-3.5 h-3.5 text-accent" />
                <span className="text-text-secondary">{t('researchGraph.totalPapers')}:</span>
                <span className="font-bold text-text-primary">{graphData.total_papers}</span>
              </div>
              <div className="px-3 py-1.5 rounded-lg border border-border-default bg-surface text-xs flex items-center gap-2">
                <User className="w-3.5 h-3.5 text-blue-600" />
                <span className="text-text-secondary">{t('researchGraph.totalAuthors')}:</span>
                <span className="font-bold text-text-primary">{graphData.total_authors}</span>
              </div>
              <div className="px-3 py-1.5 rounded-lg border border-border-default bg-surface text-xs flex items-center gap-2">
                <Tag className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-text-secondary">{t('researchGraph.totalTopics')}:</span>
                <span className="font-bold text-text-primary">{graphData.total_topics}</span>
              </div>
            </div>
          )
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6 min-h-0">

      {/* Main Graph & Inspector Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-[500px]">
        {/* Left 2 Cols: Interactive Graph Canvas */}
        <div className="lg:col-span-2 border border-border rounded-xl bg-surface flex flex-col overflow-hidden relative shadow-sm">
          {/* Canvas Toolbar */}
          <div className="p-3 border-b border-border bg-sunken/30 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-secondary" />
                <input
                  type="text"
                  placeholder="Search graph nodes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 pr-3 py-1 text-xs rounded-md border border-border bg-surface text-primary focus:outline-none focus:ring-1 focus:ring-accent w-44"
                />
              </div>

              <div className="flex items-center gap-1 bg-surface border border-border rounded-md p-0.5">
                <button
                  onClick={() => setFilterType('all')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-[transform,background-color,color] duration-150 active:scale-95 ${
                    filterType === 'all' ? 'bg-accent text-accent-solid-fg' : 'text-secondary hover:text-primary'
                  }`}
                >
                  {t('researchGraph.allTypes')}
                </button>
                <button
                  onClick={() => setFilterType('paper')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-[transform,background-color,color] duration-150 active:scale-95 ${
                    filterType === 'paper' ? 'bg-accent text-accent-solid-fg' : 'text-secondary hover:text-primary'
                  }`}
                >
                  {t('researchGraph.papersOnly')}
                </button>
                <button
                  onClick={() => setFilterType('author')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-[transform,background-color,color] duration-150 active:scale-95 ${
                    filterType === 'author' ? 'bg-accent text-accent-solid-fg' : 'text-secondary hover:text-primary'
                  }`}
                >
                  {t('researchGraph.authorsOnly')}
                </button>
                <button
                  onClick={() => setFilterType('topic')}
                  className={`px-2 py-0.5 rounded text-[11px] font-medium transition-[transform,background-color,color] duration-150 active:scale-95 ${
                    filterType === 'topic' ? 'bg-accent text-accent-solid-fg' : 'text-secondary hover:text-primary'
                  }`}
                >
                  {t('researchGraph.topicsOnly')}
                </button>
              </div>
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setZoomLevel((z) => Math.min(1.8, z + 0.15))}
                    className="p-1 text-secondary hover:text-primary rounded hover:bg-sunken transition-[transform,background-color] duration-150 active:scale-90"
                  >
                    <ZoomIn className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Zoom in</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setZoomLevel((z) => Math.max(0.6, z - 0.15))}
                    className="p-1 text-secondary hover:text-primary rounded hover:bg-sunken transition-[transform,background-color] duration-150 active:scale-90"
                  >
                    <ZoomOut className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Zoom out</TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setZoomLevel(1)}
                    className="p-1 text-secondary hover:text-primary rounded hover:bg-sunken transition-[transform,background-color] duration-150 active:scale-90"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>Reset zoom</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* SVG Network Graph */}
          <div
            ref={containerRef}
            className="flex-1 w-full h-full min-h-[420px] bg-canvas/40 relative overflow-hidden flex items-center justify-center cursor-grab active:cursor-grabbing"
          >
            {isLoading ? (
              <div className="flex flex-col items-center gap-3">
                <div className="skeleton w-full h-64 rounded-xl flex items-center justify-center">
                  <div className="flex items-center gap-2 text-secondary text-xs animate-pulse-subtle">
                    <Sparkles className="w-4 h-4 animate-spin text-accent" />
                    Synthesizing Citation Network...
                  </div>
                </div>
                <div className="flex gap-2 w-full">
                  {[0,1,2].map(i => <div key={i} className="h-3 flex-1 bg-sunken rounded-full animate-pulse" style={{ animationDelay: `${i*80}ms` }} />)}
                </div>
              </div>
            ) : filteredNodes.length === 0 ? (
              <div className="text-secondary text-xs">No graph nodes match your query.</div>
            ) : (
              <svg
                width="700"
                height="520"
                viewBox="0 0 700 520"
                className="transition-transform duration-400"
                style={{ transform: `scale(${zoomLevel})`, transitionTimingFunction: 'var(--ease-spring, cubic-bezier(0.16,1,0.3,1))' }}
              >
                {/* Defs for gradients / markers */}
                <defs>
                  <marker
                    id="arrowhead"
                    markerWidth="8"
                    markerHeight="6"
                    refX="14"
                    refY="3"
                    orient="auto"
                  >
                    <polygon points="0 0, 8 3, 0 6" fill="#8A8985" opacity="0.6" />
                  </marker>
                </defs>

                {/* Edges */}
                <g className="edges">
                  {filteredEdges.map((edge: GraphEdgeDTO, i: number) => {
                    const src = nodeMap.get(edge.source);
                    const tgt = nodeMap.get(edge.target);
                    if (!src || !tgt) return null;
                    const isHighlighted =
                      selectedNode && (selectedNode.id === src.id || selectedNode.id === tgt.id);

                    return (
                      <line
                        key={i}
                        x1={src.x}
                        y1={src.y}
                        x2={tgt.x}
                        y2={tgt.y}
                        stroke={isHighlighted ? '#2C5F4A' : '#E4E2DE'}
                        strokeWidth={isHighlighted ? 2.5 : 1}
                        strokeDasharray={edge.type === 'cites' ? 'none' : '3 3'}
                        opacity={isHighlighted ? 0.9 : 0.4}
                      />
                    );
                  })}
                </g>

                {/* Nodes */}
                <g className="nodes">
                  {filteredNodes.map((node: GraphNodeDTO) => {
                    const isSelected = selectedNode?.id === node.id;
                    const r = node.type === 'paper' ? 14 : node.type === 'author' ? 10 : 8;

                    let fillColor = '#2C5F4A'; // default accent
                    if (node.type === 'author') fillColor = '#3B82F6';
                    if (node.type === 'topic') fillColor = '#D97706';

                    return (
                      <g
                        key={node.id}
                        transform={`translate(${node.x}, ${node.y})`}
                        onClick={() => setSelectedNode(node)}
                        className="cursor-pointer group"
                      >
                        <circle
                          r={r}
                          fill={fillColor}
                          fillOpacity={isSelected ? 1 : 0.85}
                          stroke={isSelected ? '#FFFFFF' : '#E4E2DE'}
                          strokeWidth={isSelected ? 3 : 1.5}
                          className="transition-transform duration-150 hover:scale-125"
                        />
                        <text
                          y={r + 12}
                          textAnchor="middle"
                          fontSize="10"
                          fontWeight={isSelected ? 'bold' : 'normal'}
                          className="fill-primary pointer-events-none select-none"
                        >
                          {node.label.length > 18 ? node.label.slice(0, 16) + '…' : node.label}
                        </text>
                      </g>
                    );
                  })}
                </g>
              </svg>
            )}
          </div>
        </div>

        {/* Right 1 Col: Node Inspector & Cluster Summary */}
        <div className="border border-border rounded-xl bg-surface p-5 flex flex-col gap-5 shadow-sm overflow-y-auto">
          <div className="border-b border-border pb-3">
            <span className="text-xs font-semibold text-secondary uppercase tracking-wider">
              {t('researchGraph.nodeInspector')}
            </span>
          </div>

          {selectedNode ? (
            <div className="flex flex-col gap-4 text-xs">
              <div className="flex items-center gap-2">
                {selectedNode.type === 'paper' && <BookOpen className="w-4 h-4 text-accent" />}
                {selectedNode.type === 'author' && <User className="w-4 h-4 text-blue-600" />}
                {selectedNode.type === 'topic' && <Tag className="w-4 h-4 text-amber-600" />}
                <span className="text-[11px] font-semibold uppercase px-2 py-0.5 rounded bg-sunken text-secondary capitalize">
                  {selectedNode.type}
                </span>
                <span className="text-[10px] text-tertiary">
                  Degree: {selectedNode.degree || 1}
                </span>
              </div>

              <h2 className="font-bold text-sm text-primary leading-snug">{selectedNode.label}</h2>

              {selectedNode.metadata?.abstract && (
                <p className="text-secondary leading-relaxed text-[11px] bg-sunken/30 p-2.5 rounded-lg border border-border">
                  {selectedNode.metadata.abstract}
                </p>
              )}

              {selectedNode.metadata?.author_names && (
                <div className="flex flex-col gap-1">
                  <span className="font-medium text-secondary">Authors:</span>
                  <span className="text-primary font-serif">
                    {selectedNode.metadata.author_names.join(', ')}
                  </span>
                </div>
              )}

              {selectedNode.metadata?.year && (
                <div className="flex items-center gap-2">
                  <span className="text-secondary">Published:</span>
                  <span className="font-semibold text-primary">{selectedNode.metadata.year}</span>
                </div>
              )}

              {/* Direct Actions */}
              {selectedNode.type === 'paper' && !!selectedNode.metadata?.paper_id && (
                <div className="flex flex-col gap-2 pt-2 border-t border-border mt-2">
                  {onOpenReader && (
                    <button
                      onClick={() => onOpenReader(String(selectedNode.metadata?.paper_id))}
                      className="w-full py-1.5 px-3 bg-accent text-accent-solid-fg rounded-lg hover:bg-accent-hover font-medium flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <BookOpen className="w-3.5 h-3.5" />
                      {t('researchGraph.openInReader')}
                    </button>
                  )}

                  {onAskChat && (
                    <button
                      onClick={() => onAskChat(String(selectedNode.metadata?.paper_id))}
                      className="w-full py-1.5 px-3 bg-surface border border-border text-primary hover:bg-sunken rounded-lg font-medium flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-accent" />
                      {t('researchGraph.askInChat')}
                    </button>
                  )}

                  {onCite && (
                    <button
                      onClick={() => onCite(String(selectedNode.metadata?.paper_id))}
                      className="w-full py-1.5 px-3 bg-surface border border-border text-primary hover:bg-sunken rounded-lg font-medium flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Quote className="w-3.5 h-3.5 text-accent" />
                      {t('researchGraph.citeInEditor')}
                    </button>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-12 text-secondary text-xs">
              Click any node in the graph to inspect its properties and relationships.
            </div>
          )}

          {/* Research Topic Clusters */}
          {graphData && graphData.clusters && graphData.clusters.length > 0 && (
            <div className="border-t border-border pt-4 flex flex-col gap-2.5">
              <span className="text-xs font-semibold text-secondary uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-accent" />
                {t('researchGraph.clusters')}
              </span>
              <div className="flex flex-col gap-2">
                {graphData.clusters.map((c: GraphClusterDTO) => (
                  <div
                    key={c.cluster_id || c.id}
                    className="p-2.5 rounded-lg border border-border bg-sunken/20 text-xs flex flex-col gap-1"
                  >
                    <div className="flex items-center justify-between font-semibold text-primary">
                      <span>{c.label}</span>
                      <span className="text-[10px] text-accent">{c.paper_count || c.size || 0} papers</span>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {c.keywords?.map((kw: string, i: number) => (
                        <span
                          key={i}
                          className="px-1.5 py-0.5 rounded bg-surface border border-border text-[10px] text-secondary"
                        >
                          #{kw}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Discovery Recommendations Section (Roadmap 9.3) */}
      <div className="border border-border rounded-xl bg-surface p-6 flex flex-col gap-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div className="flex items-center gap-2">
            <Compass className="w-5 h-5 text-accent" />
            <div>
              <h2 className="font-bold text-sm text-primary">{t('researchGraph.discoverRelated')}</h2>
              <p className="text-xs text-secondary">{t('researchGraph.discoverySubtitle')}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {recommendations.map((rec, idx) => (
            <div
              key={rec.id}
              style={{ animationDelay: `${Math.min(idx * 40, 280)}ms` }}
              className="p-4 rounded-xl border border-border bg-sunken/20 hover:bg-surface hover:border-accent/20 hover:shadow-md [@media(hover:hover)]:hover:-translate-y-px transition-[transform,box-shadow,border-color,background-color] duration-150 flex flex-col justify-between gap-3 text-xs shadow-xs animate-fade-slide-in"
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="px-1.5 py-0.5 rounded bg-accent/10 text-accent font-semibold">
                    {typeof rec.relevance_score === 'number' ? `${Math.round(rec.relevance_score * 100)}% match` : '—'}
                  </span>
                  <span className="text-tertiary">{rec.year || '—'}</span>
                </div>

                <h3 className="font-semibold text-primary line-clamp-2 leading-snug">{rec.title}</h3>

                <p className="text-secondary text-[11px] line-clamp-2 leading-relaxed">
                  {rec.abstract}
                </p>

                <div className="p-2 rounded bg-surface border border-border/80 text-[10px] text-secondary">
                  <span className="font-semibold text-accent">Reason:</span> {rec.reason}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/60">
                <span className="text-[10px] text-tertiary font-mono">
                  {rec.arxiv_id ? `arXiv:${rec.arxiv_id}` : rec.doi}
                </span>
                <button
                  onClick={() => handleAddToLibrary(rec)}
                  disabled={addedRecIds.includes(rec.id)}
                  className="px-2.5 py-1 text-[11px] bg-accent text-accent-solid-fg rounded-md hover:bg-accent-hover disabled:opacity-60 disabled:cursor-not-allowed font-medium flex items-center gap-1 transition-[transform,background-color,opacity] duration-150 active:scale-95"
                >
                  {addedRecIds.includes(rec.id) ? (
                    <>
                      <Check className="w-3 h-3" />
                      {t('researchGraph.addedToLibrary')}
                    </>
                  ) : (
                    <>
                      <Plus className="w-3 h-3" />
                      {t('researchGraph.addToLibrary')}
                    </>
                  )}
                 </button>
               </div>
             </div>
           ))}
         </div>
       </div>
      </div>
    </div>
  );
};
