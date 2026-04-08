import type { PreparedRoute } from "./route.js";

export interface RendererApi {
  setScene(scene: PreparedRoute): Promise<void>;
  primeTiles(): Promise<void>;
  renderFrame(progress: number): Promise<void>;
}

export interface RendererWindow {
  __MAP_RENDERER__?: RendererApi;
  __MAP_RENDERER_READY__?: boolean;
}

interface RendererMessageBase {
  namespace: "mapanim";
  requestId?: string;
}

export interface RendererReadyMessage extends RendererMessageBase {
  type: "ready";
}

export interface RendererCompleteMessage extends RendererMessageBase {
  type: "command-complete";
}

export interface RendererErrorMessage extends RendererMessageBase {
  type: "command-error";
  message: string;
}

export interface SetSceneMessage extends RendererMessageBase {
  type: "set-scene";
  requestId: string;
  scene: PreparedRoute;
}

export interface PrimeTilesMessage extends RendererMessageBase {
  type: "prime-tiles";
  requestId: string;
}

export interface RenderFrameMessage extends RendererMessageBase {
  type: "render-frame";
  requestId: string;
  progress: number;
}

export type RendererCommandMessage =
  | SetSceneMessage
  | PrimeTilesMessage
  | RenderFrameMessage;

export type RendererResponseMessage =
  | RendererReadyMessage
  | RendererCompleteMessage
  | RendererErrorMessage;

export type RendererMessage = RendererCommandMessage | RendererResponseMessage;
