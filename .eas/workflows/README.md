# EAS Workflows (BASERA)

Manual workflows only - nothing runs on push or on a schedule.

## publish-preview-ota.yml

Publishes an Android OTA update to the preview channel (runtime 1.1.0).

- Dry run (default): eas workflow:run publish-preview-ota.yml -F publish=false
  Exports the bundle in EAS Cloud and publishes NOTHING.
- Publish: eas workflow:run publish-preview-ota.yml -F publish=true
  Only on the owner explicit request.
