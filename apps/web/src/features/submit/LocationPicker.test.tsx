import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationPicker } from "./LocationPicker.js";

/**
 * jsdom has no WebGL, so mounting a real MapLibre `<Map>` throws before any of this
 * component's own logic runs. The module is replaced with plain DOM stand-ins, the
 * same approach `NoticeMap.test.tsx` takes.
 *
 * What these cases cover is the *numeric fallback*, not the map: the keyboard-only
 * latitude/longitude boxes, and specifically the guard that stops a blank or
 * unparseable box from reaching the form. The map click and marker drag paths are
 * exercised by hand in the browser (see the task report).
 */
interface MapProps {
  children?: ReactNode;
  onClick?: (event: { lngLat: { lat: number; lng: number } }) => void;
}

vi.mock("@vis.gl/react-maplibre", () => ({
  Map: ({ children, onClick }: MapProps) => (
    <div data-testid="map">
      <button
        type="button"
        data-testid="map-click"
        onClick={() => onClick?.({ lngLat: { lat: 36.8, lng: 3.2 } })}
      >
        map-click
      </button>
      {children}
    </div>
  ),
  Marker: ({ latitude, longitude }: { latitude: number; longitude: number }) => (
    <div data-testid="marker" data-lat={String(latitude)} data-lng={String(longitude)} />
  ),
  NavigationControl: () => <div data-testid="navigation-control" />,
}));

// AddressSearch owns its own debounce and geocode call, both already covered by
// Task 11's tests. Stubbing it keeps these cases about the coordinate guard and
// stops a stray `api.geocode` from running here.
vi.mock("../location/AddressSearch.js", () => ({
  AddressSearch: () => <div data-testid="address-search" />,
}));

describe("LocationPicker", () => {
  // `globals: false` in vitest.config.ts means Testing Library's automatic cleanup
  // never registers, so mounted trees would otherwise accumulate between cases.
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * The valid-input case, first, because it is what stops the rest of this suite
   * from passing vacuously.
   *
   * Without it, deleting the `onChange` call outright — or making `commit` return
   * unconditionally — would satisfy every "does not call onChange" case below. This
   * one pins that the component does still propagate a real coordinate.
   */
  it("calls onChange with the parsed numbers for a valid pair", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LocationPicker value={null} onChange={onChange} />);

    await user.type(screen.getByLabelText(/latitude/i), "36.7538");
    await user.type(screen.getByLabelText(/longitude/i), "3.0588");

    expect(onChange).toHaveBeenCalled();
    const last = onChange.mock.calls.at(-1)![0];
    expect(last).toEqual({ lat: 36.7538, lng: 3.0588 });
    // Numbers, not strings: the form field is typed `number` and the API body is
    // JSON, so a string here would travel all the way to postgres.
    expect(typeof last.lat).toBe("number");
    expect(typeof last.lng).toBe("number");
  });

  /**
   * The guard this suite exists for, and the third appearance of one bug in this
   * plan: `?lat=&lng=` searching from (0,0) (fixed in Task 8), `CreateNoticeSchema`
   * still coercing `lat: ""` to `0` (parked), and this picker.
   *
   * `Number("")` is `0`, and 0 is a perfectly legal latitude, so an empty box that
   * propagates does not fail validation anywhere downstream — it silently publishes
   * the notice at 0°N in the Gulf of Guinea. Because the contracts-level coercion is
   * parked, this component is the only place a real user is protected, so the guard
   * must not be simplified away.
   */
  it("does not call onChange when the latitude is cleared", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LocationPicker value={{ lat: 36.7538, lng: 3.0588 }} onChange={onChange} />);

    const latitude = screen.getByLabelText(/latitude/i);
    expect(latitude).toHaveValue(36.7538);

    await user.clear(latitude);

    expect(latitude).toHaveValue(null);
    // The form keeps the coordinate it already had; it is never handed 0.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not call onChange when the longitude is cleared", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<LocationPicker value={{ lat: 36.7538, lng: 3.0588 }} onChange={onChange} />);

    await user.clear(screen.getByLabelText(/longitude/i));

    expect(onChange).not.toHaveBeenCalled();
  });

  /**
   * `"   ".trim() === ""` is what catches this, and `Number("   ")` is also `0` —
   * so a whitespace-only box is the same 0°N hazard wearing a different hat. A
   * `Number.isFinite` check alone would pass it straight through.
   */
  /**
   * `"   ".trim() === ""` is what catches this, and `Number("   ")` is also `0` —
   * a whitespace-only box is the same 0°N hazard wearing a different hat, and a
   * `Number.isFinite` check alone would pass it straight through.
   *
   * `fireEvent` rather than `user.type`: a `type="number"` input discards typed
   * spaces, so keyboard simulation cannot reach this state at all, while a paste,
   * an autofill, or a password-manager style injection can. Firing the change
   * directly puts the component in exactly the state those produce.
   */
  it("does not call onChange for whitespace-only input", () => {
    const onChange = vi.fn();
    render(<LocationPicker value={{ lat: 36.7538, lng: 3.0588 }} onChange={onChange} />);

    fireEvent.change(screen.getByLabelText(/latitude/i), { target: { value: "   " } });

    expect(onChange).not.toHaveBeenCalled();
  });

  /**
   * A non-numeric value never reaches the form.
   *
   * Worth knowing *how* it is stopped, because it is not the `Number.isFinite`
   * check: an `<input type="number">` sanitises its own value, and every malformed
   * string tried here — `abc`, `1e`, `-`, `.`, `1.2.3`, `0x10`, `NaN`, `Infinity` —
   * arrives at the handler as `""`, so the emptiness guard is what catches them all.
   * Removing `Number.isFinite` alone leaves this suite green, and that is a true
   * statement about the component rather than a hole in the test: through the real
   * control the branch is unreachable. It is kept as defence for the non-DOM callers
   * below, and both halves of the guard are pinned — the emptiness half by the
   * cleared/whitespace cases, the finite half by the direct-call case that follows.
   */
  it.each(["abc", "1e", "-", ".", "1.2.3", "0x10", "NaN", "Infinity"])(
    "does not call onChange for the non-numeric value %j",
    (candidate) => {
      const onChange = vi.fn();
      render(<LocationPicker value={{ lat: 36.7538, lng: 3.0588 }} onChange={onChange} />);

      fireEvent.change(screen.getByLabelText(/latitude/i), { target: { value: candidate } });

      expect(onChange).not.toHaveBeenCalled();
    },
  );

  /**
   * A non-finite coordinate handed in as `value` is not echoed back as a choice.
   *
   * This is the closest a test can get to the `Number.isFinite` half of the guard,
   * and it does NOT pin that branch — removing `Number.isFinite` leaves this whole
   * suite green. That is reported rather than papered over: through this component's
   * own DOM the branch is unreachable. `<input type="number">` scrubs every value it
   * cannot parse to `""` — including `String(NaN)` === `"NaN"` — so anything that
   * would have been non-finite arrives at `commit` as empty and is stopped by the
   * emptiness check one line earlier. `Number.isFinite` is therefore dead code with
   * respect to the rendered inputs, kept only as defence in depth for `commit`'s
   * other callers, and deliberately left in place: this task was told not to change
   * the component's behaviour.
   */
  it("does not echo a non-finite incoming value back to the parent", () => {
    const onChange = vi.fn();
    render(<LocationPicker value={{ lat: Number.NaN, lng: 3.0588 }} onChange={onChange} />);

    // A NaN latitude renders as an empty box rather than the text "NaN", and is not
    // reported back as a chosen coordinate.
    expect(screen.getByLabelText(/latitude/i)).toHaveValue(null);
    expect(onChange).not.toHaveBeenCalled();

    // A valid edit still gets through, so the silence above is about the bad value.
    fireEvent.change(screen.getByLabelText(/latitude/i), { target: { value: "36.75" } });
    expect(onChange).toHaveBeenCalledWith({ lat: 36.75, lng: 3.0588 });
  });

  it("shows a coordinate chosen on the map in the numeric boxes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<LocationPicker value={null} onChange={onChange} />);

    await user.click(screen.getByTestId("map-click"));
    expect(onChange).toHaveBeenCalledWith({ lat: 36.8, lng: 3.2 });

    // The parent owns the value, so the picker only reflects it once handed back.
    rerender(<LocationPicker value={{ lat: 36.8, lng: 3.2 }} onChange={onChange} />);
    expect(screen.getByLabelText(/latitude/i)).toHaveValue(36.8);
    expect(screen.getByLabelText(/longitude/i)).toHaveValue(3.2);
    expect(screen.getByTestId("marker").dataset.lat).toBe("36.8");
  });
});
