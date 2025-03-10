import { getAccessToken, getWabaID, getPhoneNumberID, registerAccount, postRegister } from "./login-flow.js";
import {sendNodeMessage, sendProductMessage, sendListMessage, sendInputMessage, sendButtonMessage, sendImageMessage, sendTextMessage, sendAudioMessage, sendVideoMessage, sendLocationMessage, fastURL, djangoURL } from "../snm.js";
import { userSessions, io, messageCache } from "../server.js";
import axios from "axios";
import { BlobServiceClient } from '@azure/storage-blob';

import FormData from 'form-data';

export async function getImageAndUploadToBlob(mediaID, access_token) {
    try {
      const account = "pdffornurenai";
      const sas = "sv=2022-11-02&ss=bfqt&srt=co&sp=rwdlacupiytfx&se=2025-06-01T16:13:31Z&st=2024-06-01T08:13:31Z&spr=https&sig=8s7IAdQ3%2B7zneCVJcKw8o98wjXa12VnKNdylgv02Udk%3D";
      const containerName = 'pdf';
  
      const blobServiceClient = new BlobServiceClient(`https://${account}.blob.core.windows.net/?${sas}`);
      const containerClient = blobServiceClient.getContainerClient(containerName);
      
      const newFileName = `media_${mediaID}`;
  
      const blockBlobClient = containerClient.getBlockBlobClient(newFileName);
      const exists = await checkBlobExists(blockBlobClient);
      if (exists == false){
        console.log("blob doesnt exist")
        const url = `https://graph.facebook.com/v16.0/${mediaID}`;
        const response = await axios.get(url, {
          headers: { "Authorization": `Bearer ${access_token}` }
        });
  
        const mediaURL = response.data?.url;
        if (!mediaURL) {
          throw new Error('Media URL not found');
        }
  
        console.log("Media URL: ", mediaURL);
  
        const mediaResponse = await axios.get(mediaURL, {
          headers: { "Authorization": `Bearer ${access_token}` },
          responseType: 'arraybuffer'
        });
  
        const mediaBuffer = mediaResponse.data;
        const contentType = mediaResponse.headers['content-type'];
  
        const uploadBlobResponse = await blockBlobClient.uploadData(mediaBuffer, {
          blobHTTPHeaders: {
            blobContentType: contentType,
          },
        });
  
        console.log(`Uploaded media ${newFileName} successfully, request ID: ${uploadBlobResponse.requestId}`);
      }
      return blockBlobClient.url;
  
    } catch (error) {
      console.error('Error:', error);
      throw error;
    }
}

export async function checkBlobExists(blockBlobClient){
    try{
      const response = await blockBlobClient.getProperties();
      return response !== null;
    } catch (error){
      if (error.statusCode === 404){
        return false;
      }
      throw error;
    }
}

export async function handleMediaUploads(name, phone, doc_name, mediaID, userSession, tenant) {
const access_token = userSession.accessToken;
const openai_key = process.env.OPENAI_API_KEY;
console.log(access_token)

let headers = { Authorization: `Bearer ${access_token}`, };
try {
    let response = await axios.get(`https://graph.facebook.com/v19.0/${mediaID}`, { headers });
    const mediaURL = response.data.url;
    console.log(mediaURL);

    response = await axios.get(mediaURL, { headers, responseType: 'arraybuffer' });
    const media = response.data;

    const base64Media = Buffer.from(media).toString('base64');

    const payload = {
        model: 'gpt-4o-mini',
        messages: [
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: travel_ticket_prompt,
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:image/jpeg;base64,${base64Media}`,
                        },
                    },
                ],
            },
        ],
    };

    const openAIHeaders = {
        Authorization: `Bearer ${openai_key}`,
        'Content-Type': 'application/json',
    };

    response = await axios.post('https://api.openai.com/v1/chat/completions', payload, { headers: openAIHeaders });

    let result = response.data.choices[0].message.content

    const startIndex =  result.indexOf('{')
    const endIndex = result.lastIndexOf('}') + 1;

    const resultJSON = JSON.parse(result.substring(startIndex, endIndex).trim())
    
    const data = {
        name: name,
        phone: phone,
        doc_name: doc_name || "default",
        data: resultJSON,
        tenant: tenant
    }
    console.log(data)
    response = await axios.post(`${djangoURL}/user-data/`, data, {headers: {'X-Tenant-Id': tenant}})
    console.log(response.data)
    
    // const query = `Which hotel should I stay in ${resultJSON.destination}?`
    
} catch (error) {
    console.error('Error:', error.response ? error.response.data : error.message);
}
}

export async function getMediaID(handle, bpid, access_token) {
  try {
    console.log("HANDLE: ", handle, bpid, access_token);
    const cacheKey = `${handle}_${bpid}_${access_token}`
    let mediaID = messageCache.get(cacheKey)

    if(!mediaID){
    // Fetch the image as an arraybuffer
    const mediaResponse = await axios.get(handle, { responseType: 'arraybuffer' });
    // console.log("response received: ", mediaResponse.data);
    const contentType = mediaResponse.headers?.['content-type']
    console.log("Content Type: ", contentType)

    // Create FormData instance
    const formData = new FormData();
    
    formData.append('file', Buffer.from(mediaResponse.data), {
      filename: 'image.jpeg',
      contentType: contentType,
    });
    formData.append('type', contentType);
    formData.append('messaging_product', 'whatsapp');

    // Send the request to Facebook Graph API to upload media
    const response = await axios.post(
      `https://graph.facebook.com/v20.0/${bpid}/media`,
      formData,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
          ...formData.getHeaders(), // Important: includes the correct Content-Type for multipart/form-data
        }
      }
    );

    console.log("Media ID Response: ", response.data);

    mediaID = response.data.id;
    messageCache.set(cacheKey, response.data.id)
  }

  return mediaID


  } catch (error) {
    console.error("Error in getMediaID:", error.response ? error.response.data : error.message);
    throw error;
  }
}

export async function convertToDataframe(document) {
  try {
    const formData = new FormData();

    formData.append("file", document); // Add directly if it's already a readable stream or Blob
    

    const response = await axios.post(`${fastURL}/upload_document`, formData, {
      headers: {
        ...formData.getHeaders(), // Set proper headers for multipart/form-data
      },
    });

    console.log("Response from FastAPI:", response.data);
    return response.data; // Return the response data if needed
  } catch (error) {
    console.error("Error uploading document:", error.message);
    throw error; // Rethrow the error to handle it in the calling function
  }
}

