var PlusConfig = {
	isVisible: function () {
		return ($('div#spent_serviceUrlConfig_container').size() > 0);
	},
	display: function (plusBarElem) {
		PlusConfig.displayWorker(plusBarElem);
	},
	displayWorker: function (plusBarElem) {
		function setFont(elem) { return setMediumFont(elem); }
		if (this.isVisible()) {
			return;
		}
		var container = $('<div id="spent_serviceUrlConfig_container"></div>');
		var btnOk = $('<button>OK</button>');
		var btnCancel = $('<button>Cancel</button>');
		var divInput = $('<div />');
		var input = $('<input type="url" spellcheck="false"></input>').width('100%');
		if (g_strServiceUrl != null)
			input.val(g_strServiceUrl);
		container.append($('<H2 text-align="center"><b>Setup Google sync:</b></H2>'));
		//review zig: handle not logged in when chrome implements onSignInChanged
		container.append(setFont($('<p>If you havent, click the Chrome menu \
<img id="imgChromeMenu" src="' + chrome.extension.getURL("images/chromenu.png") + '" title="Not this one, the one on the top-right of your screen."/> of this browser and \
<A target="_blank" href="https://support.google.com/chrome/answer/185277?hl=en">sign in to Chrome.</A> <b>Note this is not the same as being signed into your gmail.</b></p>')));

		container.find("#imgChromeMenu").click(function () {
			alert("Not this one, the one on the top-right of your screen.");
		});
		container.append(setFont($('<p>You must be signed in to Chrome with the same email in all your devices to use Google sync.</p>')));
		container.append(setFont($('<p>Only configure ONE device. The rest will automatically pick up the new configuration (simply open or refresh trello on them).</p>')));
		container.append(setFont($('<p>Read <b><A target="_blank" href="http://spentfortrello.blogspot.com/2014/01/plus-configuration-options.html">here</A></b> for more details.</p>')));
		container.append($('<p>&nbsp</p>'));
		container.append(setFont($('<p>Enter the full spreadsheet url where data will be stored. ("Spent backend" users: type the service URL instead)</p>')));


		var btnCreate = setFont($('<button id="buttonCreateSs"></button>')).css('margin-bottom', '5px');
		var strCreate = "Create a new sync spreadsheet";
		btnCreate.text(strCreate);
		if (g_strServiceUrl == null || g_strServiceUrl == "")
			btnCreate.show();
		else {
			btnCreate.hide();
			container.append(setFont($('<p>To create a new spreadsheet, first clear this one and press OK.</p>')));
		}
		container.append(btnCreate);
		divInput.append(setFont(input));
		container.append(divInput);
		container.append(setFont($('<p>Example: https://docs.google.com/...?key=blahblah#gid=4</p>')));
		container.append(setFont($('<p>To use in team mode, all team members should put the same url, and all need write permissions to the sheet.</p>')));
		container.append(setFont($('<p>You may rename, move the spreadsheet or rename/create more sheets, but do NOT modify the first sheet.</p>')));
		container.append(btnOk).append(btnCancel);
		container.append($('<p>&nbsp</p>'));
		var body = $('body');
		btnCancel.click(function () {
			PlusConfig.close(false);
		});

		btnCreate.click(function () {
			setBusy(true);
			btnCreate.prop('disabled', true);
			btnCreate.text("Creating spreadsheet. Approve Google permissions..");
			sendDesktopNotification("Please wait while Plus creates your sync spreadsheet.", 6000);
			sendExtensionMessage({ method: "createNewSs" },
			function (response) {
				setBusy(false);
				if (response.status != "OK") {
					setTimeout(function () { //review zig: convert all requests to sendmessage. here timeout needed because alert causes exception
						alert("Error: " + response.status);
						btnCreate.text(strCreate);
						btnCreate.prop('disabled', false);
						return;
					}, 100);
					return;
				}
				btnCreate.text("Spreadsheet created OK");
				btnCreate.prop('disabled', true);
				input.val("https://docs.google.com/spreadsheet/ccc?key=" + response.id + "#gid=0");
				btnOk.css("background", "yellow");

			});
		});
		btnOk.click(function () {
			var url = input.val().trim();
			var bError = false;
			if (g_strServiceUrl == url || (g_strServiceUrl == null && url == "")) {
				PlusConfig.close(false);
				return;

			}
			var bSimplePlus = (url.indexOf("https://docs.google.com/") == 0);
			if (url != "" && !bSimplePlus &&
				url.indexOf("https://script.google.com/") != 0) {
				alert("Invalid url format. Enter the correct url, or cancel.");
				return;
			}
			if (bSimplePlus && (url.indexOf("key=") < 0 || url.indexOf("#gid=") < 0)) {
				alert("Invalid Google spreadsheet url format. It must have a 'key' and '#gid'.");
				return;
			}

			var strOldStorage = g_strServiceUrl;

			if (strOldStorage != null && strOldStorage.trim() != "") {
				if (!confirm("By changing the URL, all local data will be cleared but will remain in your sync spreadsheet.\nAre you sure you want to modify this setup URL?"))
					return;
			}

			sendExtensionMessage({ method: "isSyncing" },
				function (response) {
					if (response.status != "OK") {
						alert(response.status);
						return;
					}

					if (response.bSyncing) {
						//note: this isnt perfect but will cover most concurrency cases
						alert("Plus is currently syncing. Try again later.");
						return;
					}

					//handle sync URL change
					g_strServiceUrl = url;

					function setLocalUrlAndRestart() {
						//need to store it also in local, otherwise the restart will detect that sync changed but we already handled that.
						var pairUrlLocal = {};
						pairUrlLocal['serviceUrlLast'] = g_strServiceUrl;
						chrome.storage.local.set(pairUrlLocal, function () {
							PlusConfig.close(true);
						});
					}

					if (bSimplePlus && (strOldStorage == null || strOldStorage.trim() == "")) {
						//preserve storage if its going from 'no sync' -> 'sync'
						//this allows a new user to start using and seeing local reports, and when it sets up the sync ss it will not lose them.
						chrome.storage.sync.set({ 'serviceUrl': g_strServiceUrl },
							function () {
								setLocalUrlAndRestart();
							});
						return;
					}

					clearAllStorage(function () {
						setLocalUrlAndRestart();
					});

				});
		});
		container.hide();
		body.append(container);
		container.fadeIn('fast', function () {
			input.focus();

		});
	},
	close: function (bReloadPage) {
		if (bReloadPage) {
			restartPlus("Settings saved. Refreshing...");
			return;
		}
		var container = $('div#spent_serviceUrlConfig_container');
		container.fadeOut('fast', function () {
			container.remove();
		});
	}
};

function restartPlus(message) {
	setBusy(true);
	sendDesktopNotification(message, 4000);
	//note: we dont use location.reload because help toc could have added # to the url thus reload will fail
	setTimeout(function () { window.location.href = "https://trello.com"; }, 2000); //see ya. use timeout so code (continuations) above have time to finish,
}

function clearAllStorage(callback) {
	chrome.storage.sync.clear(function () {
		chrome.storage.local.clear(function () {
			sendExtensionMessage({ method: "clearAllStorage" },
				function (response) {
					setTimeout(function () {
						chrome.storage.sync.set({ 'serviceUrl': g_strServiceUrl, 'bIgnoreZeroECards': g_bIgnoreZeroECards, 'bAcceptSFT': g_bAcceptSFT, 'bUserSaysDonated': g_bUserDonated },
							function () {
								if (callback !== undefined)
									callback();
							});
					}, 1000); //wait 1000 to avoid quota issues after sync.clear
				});
		});
	});
}

function sendDesktopNotification(strNotif, timeout) {
	if (timeout === undefined)
		timeout = 4000;

	sendExtensionMessage({ method: "showDesktopNotification", notification: strNotif, timeout: timeout }, function (response) { });
}

function RequestNotificationPermission(callback) {
	window.webkitNotifications.requestPermission(callback);
}
