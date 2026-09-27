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

export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
