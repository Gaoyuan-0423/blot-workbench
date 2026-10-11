# Configurable vision API guide

[中文指南](vision-api.md) · [Project user guide](user-guide.en.md) · [Documentation index](README.md)

Applies to local development version `0.2.0-dev.1`. This stage connects an API and tests a built-in synthetic image; it is **not a complete batch Western blot analyzer**. The published `0.1.0-alpha.1` website and downloads have not been replaced.

In the development version, **User guide / 使用教程** in the sidebar opens a standalone `#guide` page that follows the top-right **EN / 中文** language switch. This document provides the detailed API instructions. The published `0.1` site does not have that new guide entry or a local API service.

## 1. Start the local application

Use Node.js 22.12 or a newer compatible version. From the project directory on this development branch, run the same commands in Windows or macOS:

```sh
npm ci
npm run local
```

Open the address printed by the terminal, default `http://127.0.0.1:4318`, and select **Vision API settings** in the sidebar. `npm run dev` starts only the frontend and does not provide the API service. Press `Ctrl+C` in the terminal to stop the local server.

To serve a production build locally with the same API:

```sh
npm run build
npm run local:preview
```

`WB_PORT` changes the default port. On macOS/Linux, use `WB_PORT=4319 npm run local`. In Windows PowerShell, use `$env:WB_PORT=4319; npm run local`. Always open the exact address printed by the server: it listens only on `127.0.0.1` and accepts API requests from its own origin. There is no desktop installer in this stage.

## 2. Configure your service

1. Enter the provider's **Base URL** and an image-capable **Model ID**. The base URL is the API prefix, such as `https://api.example.com/v1`, without `/chat/completions`, credentials, query parameters, or a fragment. This example address is not a real service. Public services must use HTTPS; a local model may use `http://127.0.0.1:port/v1` or localhost.
2. Enter the **API Key**, then select **Save to local service**. Saving changes only the local in-memory configuration; it does not send an image or request a model response. An unauthenticated local model can use a blank key.
3. For the same service origin, leaving the key blank retains its saved value. Changing the protocol, hostname, or port does not reuse the old key. The interface clears a newly entered key when the service origin changes. The saved key is never displayed or returned to the page; its status is shown instead.
4. Check the saved destination and model in the test section. Unsaved changes disable testing. Saving successfully clears the key input. Restarting the service clears all configuration, so enter it again when needed.

Configuration and keys do not go into browser localStorage/IndexedDB, project exports, application logs, or the web build. While you type, the key necessarily passes through the current page's memory before being sent to the same-origin local service. This is not an encrypted-storage guarantee and does not describe the provider's own logging policies.

## 3. Send the synthetic test

Select **Send synthetic image & test** only after checking the destination. The service receives a fixed six-lane synthetic PNG and a fixed prompt. **The current project, experimental images, sample names, and lane descriptions are not sent.** The provider may charge for this request; the app does not automatically retry.

A valid response displays the number of candidate rectangles and whether it equals 6. **A matching count does not prove correct localization, scientific accuracy, or suitability for experimental images.** The prompt requests a JSON object containing a `bands` array, with 1–24 rectangles. Each rectangle has integer `x`, `y`, `width`, and `height` values inside the 720 × 280 image, for example:

```json
{"bands":[{"x":48,"y":108,"width":72,"height":36}]}
```

This illustrates the response shape, not an expected six-band answer or a measured result. The model does not provide grayscale intensities. Candidate responses are not used to update project ROIs or calculate experimental values.

Use **Cancel test** to stop waiting, or close the settings panel to cancel pending requests. Cancellation cannot retract data already received by the provider. The local 60-second timeout and response-size limit are **not billing limits**; the provider may continue processing and charging after a local cancellation or timeout.

Only one test runs at a time. Configuration changes are blocked while it runs. **Clear configuration & key** removes the local configuration explicitly.

## 4. Compatibility and data boundaries

The supported adapter uses OpenAI-compatible Chat Completions: `model`, `messages`, an `image_url` input, and JSON text inside `choices[0].message.content`. The model must support system messages and image inputs. The app does not force provider-specific structured-output, temperature, or generation-length parameters; generation behavior and usage follow the provider's defaults. Compatibility has not been verified with every provider.

Responses are validated locally for the strict JSON structure, integer coordinates, image bounds, and duplicate rectangles. Truncated, refused, or invalid outputs are rejected. The app does not automatically switch models or retry.

The browser talks only to the same-origin local API:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/vision/config` | Returns safe configuration: `{baseUrl, model, keyConfigured, revision, protocol}`. |
| `POST /api/vision/config` | Saves `{baseUrl, model, apiKey?}`. An omitted key follows the same-origin retention rule; an explicitly empty key clears it. |
| `DELETE /api/vision/config` | Clears configuration and key. |
| `POST /api/vision/test` | Accepts only `{revision}`. The server chooses the fixed synthetic input; callers cannot supply images, projects, or arbitrary prompts. |

Errors use `{error:{code,message}}` and do not echo raw provider error bodies. Host, Origin, and Fetch Metadata checks restrict local API access; the server does not follow provider redirects. A public static deployment displays local startup instructions, has no key-entry form, and does not try to contact a local API.

## 5. If something does not work

| What you see | What to check |
| --- | --- |
| Configuration cannot be loaded | Start with `npm run local`, not `npm run dev`, and open the exact printed address. |
| The test button is disabled | Save valid settings first and resolve unsaved edits; wait for a running request or cancel it. |
| `CONFIG_CHANGED` | Another page changed the saved configuration. Close and reopen settings, inspect the refreshed destination, and try explicitly again. |
| `UPSTREAM_FAILED` | Check the API prefix, model ID, credentials, and provider availability. Do not paste your key into an issue or screenshot. |
| `INVALID_RESPONSE` | The provider did not return acceptable candidate JSON. A successful network connection alone does not mean its response format is compatible. |
| `UPSTREAM_TIMEOUT` | The local waiting limit was reached. Check provider-side status and usage before choosing whether to send another request. |

## Validation and future scope

```sh
npm run check
npm run test:vision:e2e
```

API tests use injected mock services. Browser integration tests run a local mock vision provider through the real local backend. Synthetic responses and test-only keys verify interface behavior and data flow, not model ability. No real provider credentials or cloud-model localization accuracy were used to establish those results. Recorded environments and outcomes are in the [API validation record](validation-vision-api.md).

Real TIFF/PNG decoding at original bit depth, batch pairing, automatic localization evaluation, scientific quantification, and automatic figure output remain separate future work. The [batch automation design](automation-design.md) describes those unimplemented stages. The existing manual synthetic-data workflow remains available independently.
