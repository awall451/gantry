// Chart.js helpers shared by the analytics and container-detail charts.

// Tooltip positioner that keeps the box out from under the cursor: anchored
// to the top of the plot, on the opposite side of the cursor's half.
export function registerSideTooltip(Tooltip) {
  if (Tooltip.positioners.side) return;
  Tooltip.positioners.side = function (_items, eventPos) {
    const area = this.chart.chartArea;
    if (!area) return false;
    const mid = (area.left + area.right) / 2;
    return {
      x: eventPos.x,
      y: area.top,
      xAlign: eventPos.x > mid ? 'right' : 'left',
      yAlign: 'top',
    };
  };
}

// Touch screens. Chart.js maps touch/pointer events to mouse events and
// processes them on the next animation frame, and the browser adds a
// compatibility mousemove/click after every tap. Net effect without help: a
// tap opens the tooltip, the touchstart is stored as the chart's "last
// event", and every chart.update() replays it, so the tooltip never closes.
//
// Rules here: while a finger is down, events flow normally (dragging shows
// values). Once it lifts, touch-originated events other than click are
// dropped at processing time, and the tooltip is cleared after Chart.js has
// drained its queue. A tap therefore only clicks (toggles a series).
export const hideTooltipOnTouchEnd = {
  id: 'hideTooltipOnTouchEnd',
  afterInit(chart) {
    const c = chart.canvas;
    if (!c) return;
    c.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') chart.$touchDown = true; }, { passive: true });
    const lift = (e) => {
      if (e.pointerType && e.pointerType !== 'touch') return;
      chart.$touchDown = false;
      setTimeout(() => {
        chart._lastEvent = null;
        chart.setActiveElements([]);
        chart.tooltip?.setActiveElements([], { x: 0, y: 0 });
        chart.update('none');
      }, 80);
    };
    for (const t of ['pointerup', 'pointercancel', 'touchend', 'touchcancel']) c.addEventListener(t, lift, { passive: true });
  },
  beforeEvent(chart, args) {
    const e = args.event;
    const n = e.native;
    const fromTouch = n?.pointerType === 'touch' || n?.sourceCapabilities?.firesTouchEvents === true || /^touch/.test(n?.type ?? '');
    if (fromTouch && e.type !== 'click' && !chart.$touchDown) return false;
  },
};

// Grafana-style tooltip: a themed surface instead of Chart.js's black box,
// no caret, thin border, muted labels and bolder values. Spread into
// options.plugins.tooltip.
export const tooltipStyle = {
  backgroundColor: 'rgba(30, 34, 53, 0.88)',
  borderColor: '#3d4270',
  borderWidth: 1,
  cornerRadius: 6,
  caretSize: 0,
  padding: 8,
  titleColor: '#e2e8f0',
  titleFont: { size: 11, weight: '600' },
  titleMarginBottom: 6,
  bodyColor: '#cbd5e1',
  bodyFont: { size: 11 },
  bodySpacing: 3,
  boxWidth: 8,
  boxHeight: 8,
  boxPadding: 4,
  usePointStyle: true,
  callbacks: {
    labelPointStyle: () => ({ pointStyle: 'rectRounded', rotation: 0 }),
  },
};

// Vertical crosshair at the hovered x while the tooltip is active.
export const crosshair = {
  id: 'crosshair',
  afterDatasetsDraw(chart) {
    const tip = chart.tooltip;
    const active = tip?.getActiveElements?.() ?? [];
    if (!active.length || !tip.opacity) return;
    const x = active[0].element.x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.restore();
  },
};

export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
