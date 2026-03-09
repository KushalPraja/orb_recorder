import type { VideoSample } from 'mediabunny';
import { ZoomEngine } from '../zoom-engine';
import { RIPPLE_COLOUR, RIPPLE_DOT_COLOUR, type RippleDrawParams } from '../zoom-engine/effects';
import type { ImageBlur, InputEvent, RecordingMeta, RendererExportRequest } from '../../../shared/types';

type ExportCanvas = OffscreenCanvas | HTMLCanvasElement;
type ExportContext2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

interface CanvasComposerConfig {
  frameWidth: number;
  frameHeight: number;
  events: InputEvent[];
  meta: RecordingMeta | null;
  request: RendererExportRequest;
  wallpaper: ImageBitmap | null;
}

function evenSize(value: number): number {
  return value + (value % 2);
}

function createCanvas(width: number, height: number): ExportCanvas {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(width, height);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getContext(canvas: ExportCanvas): ExportContext2D {
  const context = canvas.getContext('2d', { alpha: true }) as ExportContext2D | null;
  if (!context) {
    throw new Error('Failed to create 2D canvas context for export.');
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  return context;
}

function drawRoundedRectPath(
  context: ExportContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.max(0, Math.min(radius, Math.floor(Math.min(width, height) / 2)));
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function drawCoverImage(
  context: ExportContext2D,
  image: ImageBitmap,
  width: number,
  height: number,
  blur: ImageBlur,
): void {
  const sourceWidth = image.width;
  const sourceHeight = image.height;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  const blurPx = blur === 'moderate' ? 10 : blur === 'strong' ? 24 : 0;
  const overscan = blurPx > 0 ? blurPx * 2 : 0;
  const dx = (width - drawWidth) / 2 - overscan;
  const dy = (height - drawHeight) / 2 - overscan;

  context.save();
  context.filter = blurPx > 0 ? `blur(${blurPx}px)` : 'none';
  context.drawImage(
    image,
    dx,
    dy,
    drawWidth + overscan * 2,
    drawHeight + overscan * 2,
  );
  context.restore();
}

function drawRipples(context: ExportContext2D, ripples: RippleDrawParams[]): void {
  for (const ripple of ripples) {
    context.save();
    context.globalAlpha = ripple.alpha * 0.65;
    context.strokeStyle = RIPPLE_COLOUR;
    context.lineWidth = ripple.thickness;
    context.beginPath();
    context.arc(ripple.dx, ripple.dy, ripple.radius, 0, Math.PI * 2);
    context.stroke();

    if (ripple.showDot) {
      context.globalAlpha = ripple.dotAlpha;
      context.fillStyle = RIPPLE_DOT_COLOUR;
      context.beginPath();
      context.arc(ripple.dx, ripple.dy, 4, 0, Math.PI * 2);
      context.fill();
    }

    context.restore();
  }
}

export class CanvasExportComposer {
  readonly outputWidth: number;
  readonly outputHeight: number;

  private readonly frameWidth: number;
  private readonly frameHeight: number;
  private readonly fps: number;
  private readonly padding: number;
  private readonly background: boolean;
  private readonly cornerRadius: number;
  private readonly shadowBlur: number;
  private readonly backgroundType: RendererExportRequest['backgroundType'];
  private readonly backgroundColor: string;
  private readonly gradientStart: string;
  private readonly gradientEnd: string;
  private readonly wallpaper: ImageBitmap | null;
  private readonly imageBlur: ImageBlur;
  private readonly sceneCanvas: ExportCanvas;
  private readonly sceneContext: ExportContext2D;
  private readonly staticCanvas: ExportCanvas;
  private readonly outputCanvas: ExportCanvas | null;
  private readonly outputContext: ExportContext2D | null;
  private readonly zoomEngine: ZoomEngine | null;

  private constructor(config: CanvasComposerConfig) {
    const { frameWidth, frameHeight, events, meta, request, wallpaper } = config;
    this.frameWidth = frameWidth;
    this.frameHeight = frameHeight;
    this.padding = request.background ? request.padding : 0;
    this.background = request.background;
    this.cornerRadius = request.background ? request.cornerRadius : 0;
    this.shadowBlur = request.background ? request.shadowBlur : 0;
    this.backgroundType = request.backgroundType;
    this.backgroundColor = request.backgroundColor;
    this.gradientStart = request.gradientStart;
    this.gradientEnd = request.gradientEnd;
    this.wallpaper = wallpaper;
    this.imageBlur = request.imageBlur;
    this.fps = request.fps;

    this.outputWidth = evenSize(this.frameWidth + this.padding * 2);
    this.outputHeight = evenSize(this.frameHeight + this.padding * 2);

    this.sceneCanvas = createCanvas(this.outputWidth, this.outputHeight);
    this.sceneContext = getContext(this.sceneCanvas);
    this.staticCanvas = createCanvas(this.outputWidth, this.outputHeight);
    this.outputCanvas = request.autoZoom ? createCanvas(this.outputWidth, this.outputHeight) : null;
    this.outputContext = this.outputCanvas ? getContext(this.outputCanvas) : null;

    this.buildStaticLayer();

    this.zoomEngine = request.autoZoom
      ? new ZoomEngine({
          canvasW: this.outputWidth,
          canvasH: this.outputHeight,
          frameW: this.frameWidth,
          frameH: this.frameHeight,
          fps: this.fps,
          zoomFactor: request.zoomFactor,
          holdDuration: request.zoomDuration,
          padding: this.padding,
          meta,
        }, events)
      : null;
  }

  static async create(config: CanvasComposerConfig): Promise<CanvasExportComposer> {
    return new CanvasExportComposer(config);
  }

  private buildStaticLayer(): void {
    const context = getContext(this.staticCanvas);
    context.clearRect(0, 0, this.outputWidth, this.outputHeight);

    if (!this.background) {
      context.fillStyle = '#000000';
      context.fillRect(0, 0, this.outputWidth, this.outputHeight);
      return;
    }

    if (this.backgroundType === 'gradient') {
      const gradient = context.createLinearGradient(0, 0, this.outputWidth, this.outputHeight);
      gradient.addColorStop(0, this.gradientStart);
      gradient.addColorStop(1, this.gradientEnd);
      context.fillStyle = gradient;
      context.fillRect(0, 0, this.outputWidth, this.outputHeight);
    } else if (this.backgroundType === 'image' && this.wallpaper) {
      drawCoverImage(context, this.wallpaper, this.outputWidth, this.outputHeight, this.imageBlur);
    } else {
      context.fillStyle = this.backgroundColor;
      context.fillRect(0, 0, this.outputWidth, this.outputHeight);
    }

    if (this.shadowBlur > 0) {
      context.save();
      context.shadowColor = 'rgba(0, 0, 0, 0.65)';
      context.shadowBlur = this.shadowBlur;
      context.shadowOffsetX = 0;
      context.shadowOffsetY = Math.max(2, Math.round(this.shadowBlur * 0.3));
      context.fillStyle = 'rgba(0, 0, 0, 1)';
      drawRoundedRectPath(
        context,
        this.padding,
        this.padding,
        this.frameWidth,
        this.frameHeight,
        this.cornerRadius,
      );
      context.fill();
      context.restore();
    }
  }

  compose(sample: VideoSample): ExportCanvas {
    this.sceneContext.clearRect(0, 0, this.outputWidth, this.outputHeight);
    this.sceneContext.drawImage(this.staticCanvas, 0, 0);

    if (this.background && this.cornerRadius > 0) {
      this.sceneContext.save();
      drawRoundedRectPath(
        this.sceneContext,
        this.padding,
        this.padding,
        this.frameWidth,
        this.frameHeight,
        this.cornerRadius,
      );
      this.sceneContext.clip();
      sample.draw(this.sceneContext, this.padding, this.padding, this.frameWidth, this.frameHeight);
      this.sceneContext.restore();
    } else {
      sample.draw(this.sceneContext, this.padding, this.padding, this.frameWidth, this.frameHeight);
    }

    if (!this.zoomEngine || !this.outputCanvas || !this.outputContext) {
      return this.sceneCanvas;
    }

    const frameNumber = Math.max(0, Math.round(sample.timestamp * this.fps));
    const state = this.zoomEngine.computeFrameState(frameNumber);
    this.outputContext.clearRect(0, 0, this.outputWidth, this.outputHeight);
    this.outputContext.drawImage(
      this.sceneCanvas,
      state.crop.x,
      state.crop.y,
      state.crop.w,
      state.crop.h,
      0,
      0,
      this.outputWidth,
      this.outputHeight,
    );
    drawRipples(this.outputContext, state.activeRipples);
    return this.outputCanvas;
  }

  dispose(): void {
    this.wallpaper?.close?.();
  }
}
