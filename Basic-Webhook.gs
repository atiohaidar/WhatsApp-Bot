const WHATSAPP_API_URL = "https://graph.facebook.com/v22.0/xxxx";  // Sesuaikan dengan API WhatsApp Anda
// https://developers.facebook.com/docs/graph-api/reference/whats-app-business-account-to-number-current-status/messages/
const API_TOKEN ="xxxx";  // Token API WhatsApp
const GOOGLE_DRIVE_FOLDER_ID = "xxxx";  // ID Folder Drive tempat menyimpan media
// Function untuk mengirim pesan ke nomor WhatsApp
function sendWhatsAppMessage(phone, message) {
    const payload = {
        messaging_product: "whatsapp",
        "recipient_type": "individual",
        to: phone,
        text: { 
                  "preview_url": false,

          body: message }
    };

    const options = {
        method: "post",
        contentType: "application/json",
        headers: { Authorization: "Bearer " + API_TOKEN },
        payload: JSON.stringify(payload)
    };

    try {
        const response = UrlFetchApp.fetch(WHATSAPP_API_URL + "/messages", options);
        const json = JSON.parse(response.getContentText());
        console.log(json)
        return json;
    } catch (error) {
        Logger.log("Error sending message: " + error.message);
        return { success: false, error: error.message };
    }
}
// Function untuk mencatat pesan masuk ke Google Sheet
function logWhatsAppMessage(phone, message, mediaUrl = "") {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Log");
    sheet.appendRow([new Date(), phone, message, mediaUrl]);
}
// Function untuk menangani webhook pesan masuk dari WhatsApp
function doGet(e){
  if (e.parameter["hub.verify_token"] === "my_secure_token") {
        return ContentService.createTextOutput(e.parameter["hub.challenge"]);
    }
    const request = JSON.parse(e.postData.contents);
    logWhatsAppMessage(JSON.stringify(request), "3", "3")
        return ContentService.createTextOutput("Error: Invalid Token").setMimeType(ContentService.MimeType.TEXT);

}
/**
 * Fungsi utama untuk menangani POST request dari webhook WhatsApp
 * @param {Object} e - Event dari POST request
 * @return {GoogleAppsScript.Content.TextOutput} - Response JSON atau pesan error
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Log").appendRow([JSON.stringify(data)])
    // Ekstrak data dari pesan
    var extractedData = extractWhatsAppData(data);

    if (extractedData) {
      // Jika ada media, unduh dan simpan ke Google Drive
      if (extractedData.media_id) {
        var mediaBlob = fetchWhatsAppMedia(extractedData.media_id);
        if (mediaBlob) {
          var fileId = saveMediaToDrive(
            mediaBlob,
            extractedData.mime_type, extractedData.file_name
          );
          extractedData.file_id = fileId; // Tambahkan file ID ke data log
        }
      }

      // Simpan log ke Google Sheets
      logToSheetMessages(extractedData);

      return ContentService.createTextOutput(
        JSON.stringify({ status: "success", message: "Pesan berhasil diproses." })
      ).setMimeType(ContentService.MimeType.JSON);
    } else {
      return ContentService.createTextOutput("No valid message found.")
        .setMimeType(ContentService.MimeType.TEXT);
    }
  } catch (error) {
    Logger.log("Error: " + error.message);
    return ContentService.createTextOutput("Error processing request")
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

/**
 * Fungsi untuk mengekstrak informasi dari JSON WhatsApp
 * @param {Object} data - JSON WhatsApp dari POST request
 * @return {Object|null} - Data yang diekstrak atau null jika tidak valid
 */
function extractWhatsAppData(data) {
  if (data.object === "whatsapp_business_account" && data.entry && data.entry.length > 0) {
    var entry = data.entry[0];
    if (entry.changes && entry.changes.length > 0) {
      var change = entry.changes[0];
      if (change.value && change.value.messages && change.value.messages.length > 0) {
        var messageData = change.value.messages[0];
        var contactData = change.value.contacts[0];
     
        var extracted = {
          id: messageData.id,
          time: messageData.timestamp,
          phone_number: contactData.wa_id,
          message: messageData.text ? messageData.text.body : (messageData[messageData.type].caption || "-"),
          type: messageData.type,
          media_id: messageData[messageData.type]?.id || null,
          mime_type: messageData[messageData.type]?.mime_type || null,
          file_name: messageData[messageData.type]?.id
            ? "WhatsApp_Media_" + messageData[messageData.type].id
            : null
        };

        return extracted;
      }
    }
  }
  return null;
}

/**
 * Fungsi untuk mengunduh media dari API WhatsApp
 * @param {string} mediaId - ID media dari WhatsApp
 * @return {Blob|null} - Blob media yang diunduh, atau null jika gagal
 */
function fetchWhatsAppMedia(mediaId) {
  var url = "https://graph.facebook.com/v12.0/" + mediaId; // Endpoint WhatsApp API
  var options = {
    method: "get",
    headers: {
      Authorization: "Bearer "+ API_TOKEN // Ganti dengan token akses API WhatsApp
    }
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    
    if (response.getResponseCode() === 200) {
      let result = JSON.parse(response.getContentText())
      response = UrlFetchApp.fetch(result.url, options)
      // let blob = response.getBlob()
      return response.getBlob(); // Kembalikan media sebagai Blob
    }
  } catch (error) {
    Logger.log("Error fetching media: " + error.message);
  }
  return null;
}

/**
 * Fungsi untuk menyimpan Blob media ke Google Drive
 * @param {Blob} blob - Blob media yang akan disimpan
 * @param {string} mimeType - MIME type dari media
 * @param {string} fileName - Nama file di Google Drive
 * @return {string} - ID file yang disimpan di Google Drive
 */
function saveMediaToDrive(blob, mimeType, fileName) {
  var folder = DriveApp.getFolderById(GOOGLE_DRIVE_FOLDER_ID); // Ganti dengan ID folder Google Drive Anda
  var file = folder.createFile(blob).setName(fileName);
  Logger.log("File saved with ID: " + file.getId());
  return file.getId(); // Kembalikan ID file
}

/**
 * Fungsi untuk mencatat log ke Google Sheets
 * @param {Object} data - Data yang akan dicatat
 */
function logToSheetMessages(data) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Messages");
  if (!sheet) {
    // Jika sheet "Log" tidak ditemukan, buat sheet baru
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet("Messages");
    // Tambahkan header
    sheet.appendRow(["ID", "Time", "Phone Number", "Message", "Type", "File ID"]);
  }

  // Tambahkan data ke sheet
  sheet.appendRow([
    data.id,
    new Date(),
    data.phone_number,
    data.message.toString() ||"-",
    data.type,
    data.file_id? "https://drive.google.com/file/d/"+data.file_id : ""
  ]);
}
