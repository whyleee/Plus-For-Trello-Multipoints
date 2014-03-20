

function getConfigData(urlService, userTrello, callback, bSkipCache) {
	var data = null;

	if (bSkipCache === undefined || bSkipCache === false)
		data = localStorage["configData"];
	if (data !== undefined && data != null)
		data = JSON.parse(data);
	if (data === undefined)
		data = null;

	if (data != null)
		callback(data);
	else {
		doCallUrlConfig(urlService, userTrello, callback);
	}
}


function doCallUrlConfig(urlConfig, userTrello, callback) {
	if (urlConfig.indexOf("https://docs.google.com/") == 0) {
		//this is hacky, but it was the easiest way to enable the simple Plus case (without spent backend)
		//pretend urlConfig is the gas script url until the last minute (here) where we build the config object
		var config = doGetJsonConfigSimplePlus(urlConfig, userTrello);
		localStorage["configData"] = JSON.stringify(config);
		callback(config);
		return;
	}
	var xhr = new XMLHttpRequest();
	xhr.timeout = g_msFetchTimeout;
	xhr.open("GET", urlConfig + "?view=jsonconfig&user=" + userTrello, true);
	xhr.setRequestHeader('Cache-Control', 'no-cache');
	xhr.onreadystatechange = function () {
		if (xhr.readyState == 4) {
			var resp = {};
			if (xhr.responseText != "") {
				localStorage["configData"] = xhr.responseText;
				resp = JSON.parse(xhr.responseText);
			}
			callback(resp);
		}
	};
	xhr.send();
}

var DATAVERSION_SIMPLEPLUS = 1;

function doGetJsonConfigSimplePlus(url, user) {
	var objRet = { version: DATAVERSION_SIMPLEPLUS, bSimplePlus: true };
	var strFindKey = "key=";
	var iKey = url.indexOf(strFindKey);
	if (iKey <= 0) {
		objRet.status = "Error: no spreadsheet key";
		return objRet;
	}
	var strRight = url.substr(iKey + strFindKey.length);
	var parts = strRight.split("#gid=");
	objRet.userTrello = user;
	objRet.urlSsUser = url;
	var partLeft = parts[0];
	if (partLeft.indexOf("&") < 0)
		objRet.idSsUser = partLeft;
	else
		objRet.idSsUser = (partLeft.split("&"))[0];
	objRet.idUserSheetTrello = gid_to_wid(parts[1]);
	objRet.status = "OK";
	return objRet;
}

// string to number
function wid_to_gid(wid) {
	return (parseInt(String(wid), 36) ^ 31578);
}

// number to string
function gid_to_wid(gid) {
	// (gid xor 31578) encoded in base 36
	return parseInt((gid ^ 31578), 10).toString(36);
}

function standarizeSpreadsheetValue(value) {
	if (value == "#VALUE!" || value == "--")
		value = "";
	if (typeof (value) == 'string' && value.indexOf("'") == 0)
		value = value.substr(1);
	return value;
}


chrome.extension.onRequest.addListener(function (request, sender, sendResponseParam) {

	function sendResponse(obj) {
		try {
			sendResponseParam(obj);
		} catch (e) {
			if (e.message.indexOf("disconnected port object") < 0) //skip disconnected ports as the user may close a trello tab anytime
				logException(e);
		}
	}

	if (request.method == "getConfigData") {
		var bSkipCache = (request.bSkipCache);
		getConfigData(request.urlService, request.userTrello, function (retConfig) {
			if (retConfig === undefined)
				sendResponse({ config: { status: "not configured" } });
			else
				sendResponse({ config: retConfig });
		}, bSkipCache);
	}
	else if (request.method == "createNewSs") {
		handleCreateSs(sendResponse);
	}
	else if (request.method == "getPlusFeed") {
		handleGetPlusFeed(request.msLastPostRetrieved, sendResponse);
	}
	else if (request.method == "checkLoggedIntoChrome") {
		handleCheckLoggedIntoChrome(sendResponse);
	}
	else if (request.method == "testBackgroundPage") {
		insertLogMessages(request.logMessages, request.bDoWriteLog, request.tuser, sendResponse);
	}
	else if (request.method == "showDesktopNotification") {
		handleShowDesktopNotification(request);
		sendResponse({});
	}
	else if (request.method == "insertHistoryRowFromUI") {
		handleInsertHistoryRowFromUI(request, sendResponse);
	}
	else if (request.method == "getReport") {
		handleGetReport(request, sendResponse);
	}
	else if (request.method == "openDB") {
		handleOpenDB(sendResponse);
	}
	else if (request.method == "syncDB") {
		handleSyncDB(request, sendResponse);
	}
	else if (request.method == "getTotalDBRows") {
		handleGetTotalRows(false, sendResponse);
	}
	else if (request.method == "getTotalDBRowsNotSync") {
		handleGetTotalRows(true, sendResponse);
	}
	else if (request.method == "getTotalDBMessages") {
		handleGetTotalMessages(sendResponse);
	}
	else if (request.method == "getlocalStorageSize") {
		sendResponse({ result: unescape(encodeURIComponent(JSON.stringify(localStorage))).length });
	}
	else if (request.method == "clearAllStorage") {
		localStorage.clear();
		handleDeleteDB(request, sendResponse);
	}
	else if (request.method == "clearAllLogMessages") {
		handleDeleteAllLogMessages(request, sendResponse);
	}
	else if (request.method == "isSyncing") {
		handleIsSyncing(sendResponse);
	}
	else if (request.method == "copyToClipboard") {
		handleCopyClipboard(request.html, sendResponse);
	}
	else
		sendResponse({});
});

function handleCopyClipboard(html, sendResponse) {
	if (window.getSelection && document.createRange) {
		var elemReplace = document.getElementById("selectionPlaceholder");
		elemReplace.innerHTML = html;
		var sel = window.getSelection();
		var range = document.createRange();
		range.selectNodeContents(elemReplace);
		sel.removeAllRanges();
		sel.addRange(range);
		document.execCommand("Copy");
		elemReplace.innerHTML = ""; //blank it when done
		sendResponse({ status: "OK" });
		return;
	}
	sendResponse({ status: "Error: cant copy to clipboard" });
}

var g_bSignedIn = false;

/* review zig: enable when chrome adds this api to release channel, and re-test
chrome.identity.onSignInChanged.addListener(function(account, signedIn) {
	g_bSignedIn = signedIn;
});
*/

//note: ntofications are done from background from here so they work correctly when navigating during notification, and chrome has them preaproved
var g_strLastNotification = "";
var g_dtLastNotification = null;

function handleShowDesktopNotification(request) {
	var dtNow = new Date();
	var dtDiff = 0;
	if (g_dtLastNotification != null) {
		if (dtNow.getTime() - g_dtLastNotification.getTime() < 10000 && g_strLastNotification == request.notification)
			return; //ingore possible duplicate notifications
	}
	g_dtLastNotification = dtNow;
	g_strLastNotification = request.notification;
	var timeout = request.timeout;
	var notification = webkitNotifications.createNotification(
						chrome.extension.getURL("images/icon48.png"),  // icon url - can be relative
						'Plus for Trello',  // notification title
						request.notification);  // notification body text

	notification.show();
	if (timeout) {
		setTimeout(function () {
			notification.cancel();
		}, timeout);
	}
}

function handleCheckLoggedIntoChrome(sendResponse) {
	sendResponse({ status: (!g_bSignedIn) ? "error" : "OK" });
	return;
}

function handleCreateSs(sendResponse) {
	var url = "https://www.googleapis.com/drive/v2/files";
	var postData = {
		'mimeType': 'application/vnd.google-apps.spreadsheet',
		'title': 'Plus for Trello sync spreadsheet'
	};
	handleApiCall(url, {}, true, function (response) {
		var id = null;
		if (response.data && response.data.id)
			id = response.data.id;
		if (id == null && response.status == "OK")
			response.status = "Unknown error creating spreadsheet";

		if (response.status != "OK")
			sendResponse({ status: response.status, id: null });
		else
			handleConfigNewSs(id, gid_to_wid(0), sendResponse);
	}, JSON.stringify(postData), "application/json");
}

function handleConfigNewSs(idSs, wid, sendResponse) {
	//write ss header
	var row = 1;
	var i = 0;
	var data = ["date", "board", "card", "spenth", "esth", "who", "week", "month", "comment", "cardurl", "idtrello"];
	var url = 'https://spreadsheets.google.com/feeds/cells/' + idSs + '/' + wid + '/private/full';
	var atom = '<feed xmlns="http://www.w3.org/2005/Atom" \
	xmlns:batch="http://schemas.google.com/gdata/batch" \
	xmlns:gs="http://schemas.google.com/spreadsheets/2006"> \
<id>'+ url + '</id>';
	for (; i < data.length; i++) {
		atom += makeCellBatchEntry(idSs, wid, 1, i + 1, data[i]);
	}
	atom += '</feed>';
	url += '/batch';
	handleApiCall(url, {}, true, function (response) {
		if (response.data && response.data.toLowerCase().indexOf("error") >= 0) {
			idSs = null; //review zig: should delete the spreadsheet
			response.status = "unknown spreadsheet write error";
		}
		sendResponse({ status: response.status, id: idSs });
	}, atom, null, true);
}


function makeCellBatchEntry(idSs, wid, row, column, value) {
	var feedUrl = "https://spreadsheets.google.com/feeds/cells/" + idSs + "/" + wid + "/private/full/R" + row + "C" + column;
	var ret = '\
<entry>\
<batch:id>A'+ row + '-' + column + '</batch:id> \
<batch:operation type="update"/> \
<id>'+ feedUrl + '</id> \
<link rel="edit" type="application/atom+xml" \
href="'+ feedUrl + '/version"/> \
<gs:cell row="'+ row + '" col="' + column + '" inputValue="' + value + '"/> \
</entry>';
	return ret;
}

function handleApiCall(url, params, bRetry, sendResponse, postBody, contentType, bAddIfMatchStar) {
	if (chrome.identity === undefined) {
		sendResponse({ status: "Please sign-in to Chrome from chrome's top-right menu." });
		return;
	}

	chrome.identity.getAuthToken({ interactive: true }, function (token) {
		if (token) {
			onAuthorized(url, params, sendResponse, token, bRetry, postBody, contentType, bAddIfMatchStar);
		} else {
			sendResponse({ status: "Not signed into Chrome, network error or no permission." });
		}
	});
}


function stringifyParams(parameters) {
	var params = [];
	for (var p in parameters) {
		params.push(encodeURIComponent(p) + '=' +
					encodeURIComponent(parameters[p]));
	}
	return params.join('&');
}

function handleGetPlusFeed(msLastPostRetrieved, sendResponse) {
	var xhr = new XMLHttpRequest();
	xhr.onreadystatechange = function (event) {
		if (xhr.readyState == 4) {
			var statusRet = "OK";
			var obj = null;

			try {
				obj=JSON.parse(xhr.responseText);
			} catch (e) {

			}
			if (obj == null) {
				sendResponse({ status: "error" });
				return;
			}

			var i = 0;
			var msDateMax = 0;
			var itemsRet = [];
			for (; i < obj.items.length; i++){
				var item = obj.items[i];
				var msDate = Date.parse(item.published);
				if (msDate <= msLastPostRetrieved || item.verb != "post")
					continue;
				itemsRet.push(item);
				if (msDate > msDateMax)
					msDateMax = msDate;
			}
			sendResponse({ status: "OK", items: itemsRet, msLastPostRetrieved: msDateMax });
			return;
		}
	};

	var url = "https://www.googleapis.com/plus/v1/people/109669748550259696558/activities/public?key=AIzaSyAKvksXJUQSqv9R9hJ4f7drfbBVyo4-7Tk&maxResults=20&fields=items(published%2Ctitle%2Curl%2Cverb)";

	xhr.open("GET", url, true);
	xhr.send();
}


function onAuthorized(url, params, sendResponse, oauth, bRetry, postBody, contentType, bAddIfMatchStar) {
	if (contentType === undefined || contentType == null)
		contentType = "application/atom+xml";
	var method = postBody ? 'POST' : 'GET';
	var paramsOriginal = JSON.parse(JSON.stringify(params)); //clone
	var xhr = new XMLHttpRequest();
	xhr.onreadystatechange = function (event) {
		if (xhr.readyState == 4) {
			var statusRet = "OK";
			if (bRetry && xhr.status == 401 && (
					xhr.statusText.indexOf("Token revoked") == 0 ||
					xhr.statusText.indexOf("Token invalid") == 0 ||
					xhr.statusText.indexOf("Unauthorized") == 0)) { //"Unauthorized" can happen if user removes token from https://accounts.google.com/IssuedAuthSubTokens
				//refresh oauth tokens
				chrome.identity.removeCachedAuthToken({ token: oauth }, function () {
					handleApiCall(url, paramsOriginal, false, sendResponse, postBody, contentType, bAddIfMatchStar);
					return;
				});
				return;
			} else {
				var data = null;
				if (xhr.status < 200 || xhr.status > 207) {
					if (xhr.status == 403)
						statusRet = "Error: no spreadsheet permission to " + (postBody ? "write." : "read.");
					else if (xhr.status == 0)
						statusRet = "No network connection.";
					else
						statusRet = "Unknown connection error.";
					sendResponse({ status: statusRet });
					return;
				}

				var bJson = ("{" == xhr.responseText.charAt(0));

				if (bJson) {
					try {
						data = JSON.parse(xhr.responseText);
					}
					catch (e) {
					}
				} else
					data = xhr.responseText;
				if (bJson && data == null) {
					sendResponse({ status: "Unknown error." });
				}
				else
					sendResponse({ data: data, status: "OK" });
			}
		}
	};
	xhr.open(method, url + '?' + stringifyParams(params), true);

	xhr.setRequestHeader('GData-Version', '3.0');
	xhr.setRequestHeader('Content-Type', contentType);
	xhr.setRequestHeader('Cache-Control', 'no-cache');
	xhr.setRequestHeader('Authorization', 'Bearer ' + oauth);
	if (bAddIfMatchStar)
		xhr.setRequestHeader('If-Match', '*');
	xhr.send(postBody);
}

