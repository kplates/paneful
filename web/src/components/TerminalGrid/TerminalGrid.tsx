import React from 'react';
import { LayoutNode } from '../../lib/layout-engine';
import { TerminalPane } from './TerminalPane';
import { ResizeHandle } from './ResizeHandle';

interface TerminalGridProps {
  node: LayoutNode;
  projectId: string;
  cwd: string;
  path?: number[];
}

export function TerminalGrid({ node, projectId, cwd, path = [] }: TerminalGridProps) {
  if (node.type === 'leaf') {
    return (
      <TerminalPane
        terminalId={node.terminalId}
        projectId={projectId}
        cwd={cwd}
      />
    );
  }

  const isVertical = node.direction === 'vertical';
  const firstSize = `${node.ratio * 100}%`;
  const secondSize = `${(1 - node.ratio) * 100}%`;

  return (
    <div
      className={`flex ${isVertical ? 'flex-row' : 'flex-col'} h-full w-full`}
    >
      <div style={{ flexBasis: firstSize, minWidth: 0, minHeight: 0, overflow: 'hidden' }} className="flex">
        <TerminalGrid
          node={node.first}
          projectId={projectId}
          cwd={cwd}
          path={[...path, 0]}
        />
      </div>

      <ResizeHandle
        projectId={projectId}
        path={path}
        direction={node.direction}
      />

      <div style={{ flexBasis: secondSize, minWidth: 0, minHeight: 0, overflow: 'hidden' }} className="flex">
        <TerminalGrid
          node={node.second}
          projectId={projectId}
          cwd={cwd}
          path={[...path, 1]}
        />
      </div>
    </div>
  );
}
