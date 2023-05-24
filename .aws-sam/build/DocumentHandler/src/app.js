/**
 * Copyright 2021 Thetis Apps Aps
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * 
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * 
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * 
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const axios = require('axios');

async function getEconomic(accessToken) {
    
    const appToken = 'Si7VAOfmXW2hkHhe6GSscgMGrrxNga5adYkQf2NGqRA1';
    
    let economic = axios.create({
            baseURL: 'https://restapi.e-conomic.com/',
    		headers: { 'X-AppSecretToken': appToken, 'X-AgreementGrantToken': accessToken, 'Content-Type': 'application/json' }
    	});
    	
	economic.interceptors.response.use(function (response) {
			console.log("SUCCESS " + JSON.stringify(response.data));
 	    	return response;
		}, function (error) {
			console.log(JSON.stringify(error));
			if (error.response) {
				console.log("FAILURE " + error.response.status + " - " + JSON.stringify(error.response.data));
			}
	    	return Promise.reject(error);
		});
		
    return economic;
}

async function getIMS() {
	
    const authUrl = "https://auth.thetis-ims.com/oauth2/";
    const apiUrl = "https://api.thetis-ims.com/2/";

	var clientId = process.env.ClientId;   
	var clientSecret = process.env.ClientSecret; 
	var apiKey = process.env.ApiKey;  
	
    let data = clientId + ":" + clientSecret;
	let base64data = Buffer.from(data, 'UTF-8').toString('base64');	
	
	var imsAuth = axios.create({
			baseURL: authUrl,
			headers: { Authorization: "Basic " + base64data, 'Content-Type': "application/x-www-form-urlencoded" },
			responseType: 'json'
		});
    
    var response = await imsAuth.post("token", 'grant_type=client_credentials');
    var token = response.data.token_type + " " + response.data.access_token;
    
    var ims = axios.create({
    		baseURL: apiUrl,
    		headers: { "Authorization": token, "x-api-key": apiKey, "Content-Type": "application/json" }
    	});

	ims.interceptors.response.use(function (response) {
			console.log("SUCCESS " + JSON.stringify(response.data));
 	    	return response;
		}, function (error) {
			console.log(JSON.stringify(error));
			if (error.response) {
				console.log("FAILURE " + error.response.status + " - " + JSON.stringify(error.response.data));
			}
	    	return Promise.reject(error);
		});

	return ims;
}

async function postMessage(ims, detail, text) {
    let message = new Object();
	message.time = Date.now();
	message.source = "EconomicAccounting";
	message.messageType = "INFO";
	message.messageText = text;
	message.deviceName = detail.deviceName;
	message.userId = detail.userId;
	await ims.post("events/" + detail.eventId + "/messages", message);
}

async function postMessages(ims, detail, transaction, lines) {
	postMessage(ims, detail, "Booked with voucher no. " + transaction.voucherNo);
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        postMessage(ims, detail, line.accountNo);
    }
}

exports.documentHandler = async (event, awsContext) => {

    console.log(JSON.stringify(event));

    let detail = event.detail;
    
    let ims = await getIMS();
    
    let response = await ims.get('documents/' + detail.documentId);
    let document = response.data;
    
    response = await ims.get("contexts/" + process.env.ContextId);
    let context = response.data;
    let dataDocument = JSON.parse(context.dataDocument);
    let setup = dataDocument.EconomicAccounting;
    
    let economic = await getEconomic(setup.accessToken);

    response = await economic.get('journals');
    let journals = response.data.collection;
    
    let i = 0;
    let found = false;
    while (i < journals.length && !found) {
        let journal = journals[i];
        if (journal.name == setup.journalName) {
            found = true;
        } else {
            i++;
        }
    }
    
    if (!found) {
        return "FAILED";
    }
    
    let journal = journals[i];
    
    let contraAccountNumber;
    let text;

    if (detail.documentType == 'GOODS_RECEIPT') {
        text = detail.inboundShipmentNumber + ' ' + document.localizedDocumentType + ' ' + document.documentNumber;
		contraAccountNumber = setup.intermediateAccount;
    } else if (detail.documentType == 'ADJUSTMENT_LIST') {
        text = document.localizedDocumentType + ' ' + document.documentNumber;
        contraAccountNumber = setup.adjustmentAccount;
    } else if (detail.documentType == 'COST_OF_SALES_LIST') {
        text = document.localizedDocumentType + ' ' + document.documentNumber;
        contraAccountNumber = setup.costOfSalesAccount;
    } else if (detail.documentType == 'COST_VARIANCE_LIST') {
        text = detail.inboundShipmentNumber + ' ' + document.localizedDocumentType + ' ' + document.documentNumber;
        contraAccountNumber = setup.intermediateAccount;
    } else if (detail.documentType == 'VALUE_ADJUSTMENT_RECEIPT') {
        text = document.localizedDocumentType + ' ' + document.documentNumber;
        contraAccountNumber = setup.deprecationAccount;
    }
    
    let voucher = {
        'accountingYear': {
            'year': setup.accountingYear 
        },
        'journal': {
            'journalNumber': journal.journalNumber
        },
        'entries': {
            'financeVouchers': [{
                'text': text,
                'amount': document.value,
                'account': {
                    'accountNumber': setup.inventoryAccount,
                },
                'contraAccount': {
                    'accountNumber': contraAccountNumber,
                },
                'currency': {
                    'code': context.baseCurrencyCode,
                },
                'date': document.postingDate,
            }]
        }
    };

    
    response = await economic.post('/journals/' + journal.journalNumber + '/vouchers', voucher);
    voucher = response.data[0].entries.financeVouchers[0].voucher;

    await postMessage(ims, detail, "Document was posted to e-conomic as voucher: " + voucher.voucherNumber);

};

