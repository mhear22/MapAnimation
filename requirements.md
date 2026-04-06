# Current Frontend Requirements Satisfied

Based on the current implementation in `webapp/`, the frontend satisfies these user requirements:

## Route Setup

- Users can create a new map animation route from the frontend.
- Users can give a route or preset a human-readable name.
- Users can specify the output MP4 file path before rendering.
- Users can start over and reset the current route back to default values.

## Location Selection

- Users can search for an origin location from the UI.
- Users can search for a destination location from the UI.
- Users receive search suggestions while typing location queries.
- Users can select a suggested search result to populate a route endpoint.
- Users are prevented from seeing search results for very short queries until enough characters are entered.
- Users can see loading feedback while location search is in progress.

## Route Configuration

- Users can choose a travel mode for the route.
- Users can choose between `walking`, `driving`, `flying`, and `public transport` modes.
- Users can choose a map style for the animation.
- Users can switch between `satellite` and `standard` map types.

## Camera And Motion Tuning

- Users can tune the route animation from the frontend without editing JSON manually.
- Users can adjust the motion curve interactively through the curve editor.
- Users can set exact numeric values for animation duration.
- Users can set exact numeric values for start zoom.
- Users can set exact numeric values for end zoom.
- Users can set exact numeric values for max altitude.
- Users can set exact numeric values for lerp aggressiveness.
- Users can set exact numeric values for camera smoothing.
- Users can see a summary of the start, farthest, and end zoom states while editing the curve.

## Preview

- Users can preview the route in the frontend before rendering.
- Users get an updated preview automatically when route inputs change.
- Users can only load a preview after both origin and destination have been entered.
- Users can scrub through the animation timeline using a progress slider.
- Users can see the current preview position as a percentage.
- Users can see route distance information when a preview route is available.
- Users can see preview status feedback, including syncing and error states.
- Users can see which start and end locations the preview currently represents.

## Presets

- Users can save the current route as a reusable preset from the frontend.
- Users can view a list of available presets in the frontend.
- Users can load an existing preset into the editor.
- Users can access presets sourced from both saved preset files and configured routes.

## Rendering Queue

- Users can queue a render job from the frontend.
- Users can view the current render queue in the frontend.
- Users can see each queued job's route summary.
- Users can see each queued job's status and current stage.
- Users can see live render progress updates without refreshing the page.
- Users can see frame-based progress details when frames are being captured.
- Users can see failures surfaced in the queue when a render job errors.
- Users can open the generated MP4 from the queue after a job completes.
