# One Aida, Many Rooms

Aida's First Memory saves one fact as a JSON file in Google Drive and reads it back with its Drive file ID and UTC timestamp. Once saved, the fact is read-only in this prototype. Repeating the same save returns the stored record. Recall always reads Drive.

## Local checks

Run `node --test` with Node.js 22 or newer. The tests simulate Google sign-in and Drive responses.

## Supervised live test

1. Confirm the intended Google account and parent location for **AIDA — ONE AIDA MANY ROOMS — DEV**. Verify the folder by ID in Drive. If it is absent, create it only after confirming the account and parent. Set its ID in `oauth.config.json`. Aida checks the folder name, type, and ID before use.
2. Approve publishing these static files to a separate GitHub Pages path on the previously documented origin, `https://aristgwetta.github.io`. One option is a new Pages project under the same account. Serve `index.html`, `style.css`, `app.mjs`, `memory.mjs`, and `oauth.config.json` together. Localhost uses a different origin.
3. Open that URL in a browser, choose **Authorize Google Drive**, select the intended account, enter a meaningful fact, and choose **Remember**. Check the JSON, Drive file ID, and timestamp.
4. Close the browser session. Reopen the URL, authorize the same account, and choose **Recall**. Repeat from a second device and compare the fact, file ID, and timestamp.

The committed client ID is a public OAuth identifier. The popup requests full Drive access and includes previously granted scopes. The folder is the initial memory destination. Access tokens live only in page memory. The app uses its own files and Google's browser and Drive APIs.

An upload retry in the same page reuses the Drive-generated file ID. A fresh session searches Drive for the existing record before writing. Run the first save on one device at a time. If multiple records are found, Aida reports the conflict.
