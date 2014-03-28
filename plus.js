var g_strServiceUrl = null; //null while not loaded. set to empty string or url
var g_msSyncPeriod = 3 * (60 * 1000);
var g_tipUserTopReport = "Click to sync now.";
var g_rgiDayName = ['su', 'mo', 'tu', 'we', 'th', 'fr', 'sa'];
var g_marginLabelChart = 35;
var g_heightBarUser = 30;
var g_bShowBoardMarkers = false;


/* isBackendMode
 *
 * REVIEW zig: warning: must be called only if g_bReadGlobalConfig, else caller should wait until later
 * all callers were verified on mar-11-2014
 **/
function isBackendMode(configData) {
	if (configData === undefined) {
		if (!g_bReadGlobalConfig)
			return false;
		configData = g_configData;
	}
	return (configData && configData.spentSpecialUser != null);
}

function setupPlusConfigLink(bParam, bNotSetUp) {
	var span = $('<span></span>').addClass('header-btn-text agile_help_setup_link').html("Setup sync")
		.css('cursor', 'pointer').css('margin-left', '0px');
	span[0].style.setProperty('font-size', '15px', 'important');
	if (bNotSetUp)
		span.css("background", "red");
	span.appendTo(bParam);
	span.click(function () {
		PlusConfig.display(bParam);
	});
}

var g_bReadGlobalConfig = false;

function configureSsLinks(bParam) {
	if (g_strServiceUrl != null) {
		configureSsLinksWorker(bParam, g_strServiceUrl);
	}
	else {
		chrome.storage.sync.get("serviceUrl", function (obj) {
			var strUrlNew = obj["serviceUrl"]; //note: its still called serviceUrl even though it might store a sheet url too.
			//ignore spent beta service url
			if (strUrlNew == null || strUrlNew === undefined || strUrlNew.indexOf("https://script.google.com/macros/s/AKfycbyYnX3jVxphIDlhWhcUn_3p5l6f-Sw5-rH905XGMgzu42VQc-U/exec") == 0)
				strUrlNew = ""; //means simple trello
			strUrlNew = strUrlNew.trim();
			var keyUrlLast = "serviceUrlLast";
			chrome.storage.local.get(keyUrlLast, function (obj) {
				var strUrlOld = obj[keyUrlLast];
				if (strUrlOld)
					strUrlOld = strUrlOld.trim();
				else
					strUrlOld = "";
				var pairUrlOld = {};
				pairUrlOld[keyUrlLast] = strUrlNew;
				chrome.storage.local.set(pairUrlOld, function () {
					g_strServiceUrl = strUrlNew;
					if (strUrlOld != strUrlNew) {
						//config changed from another device.
						var messageRestart = "Plus detected a new sync configuration. Refreshing...";
						if (strUrlOld != "") {
							clearAllStorage(function () {
								restartPlus(messageRestart);
							});
							return;
						}
					}
					configureSsLinksWorker(bParam, strUrlNew);
				});
			});
		});
	}
}

var g_userTrelloCurrent = null;

/* getCurrentTrelloUser
 *
 * returns null if user not logged in, or not yet loaded
 * else returns user (without @)
 **/
function getCurrentTrelloUser() {
	if (g_userTrelloCurrent != null)
		return g_userTrelloCurrent;
	var headerBarItem = $(".js-open-header-member-menu");
	if (headerBarItem.length == 0) {
		headerBarItem = $(".header-auth");
		if (headerBarItem.length == 0) {
			//try later. most likely user not logged-in 
			return null;
		}
	}
	var avatarElem = headerBarItem.eq(0).find($(".member-avatar"))[0];
	if (avatarElem === undefined)
		avatarElem = headerBarItem.eq(0).find($(".member-initials"))[0];
	if (avatarElem === undefined)
		return null;
	var userElem = avatarElem.title;
	userElem = userElem.slice(0, userElem.indexOf('(')).trim();
	// userElem = userElem.split("(")[1];
	// userElem = userElem.split(")")[0];
	g_userTrelloCurrent = userElem;

	//save the user, we need to know it from pages like dashboard
	var pairUser = {};
	pairUser[PROP_TRELLOUSER] = userElem;
	chrome.storage.local.set(pairUser, function () { });

	return userElem;
}

var g_configData = null; //set to non-null when sync is configured


//returns true iff progress set. false when progress was already set
function setWeekSummaryProgress(elem) {
	var strClass = "agile_sync_state";

	if (elem.hasClass(strClass))
		return false;
	elem.addClass(strClass);
	elem.attr("title", "Syncing with Google...");
	return true;
}

function removeWeekSummaryProgress(elem) {
	var strClass = "agile_sync_state";
	elem.removeClass(strClass);
}

var g_bCreatedPlusHeader = false; //review zig: get rid of this by always creating 'new' icon hidden when #urlUser is created.

function configureSsLinksWorker(b, url, bSkipConfigCache) {
	var userElem = getCurrentTrelloUser();
	if (userElem == null) {
		//try later. most likely user not logged-in 
		setTimeout(function () { configureSsLinksWorker(b, url, bSkipConfigCache); }, 500);
		return;
	}

	var trelloLogo = $(".header-logo-default");
	if (trelloLogo.length > 0) {
		var parentLogo = trelloLogo.parent();
		parentLogo.css('left', '308px');
		parentLogo.css('margin-left', '0px');
	}

	var urlUserElem = $('#urlUser');
	if (urlUserElem.length == 0) {
		g_bCreatedPlusHeader = true;
		urlUserElem = $('<a id="urlUser"></a>').css("margin-left", "0px").css("margin-right", "2px");
		urlUserElem.addClass('agile_plus_header_link agile_plus_header_link_zoomhover');
		urlUserElem.appendTo(b);
		getRecentWeeksList(urlUserElem).appendTo(b);
	}

	var urlReportElem = $("#urlReportElem");
	if (urlReportElem.length == 0) {
		$('<a id="urlReportElem" href="' + chrome.extension.getURL("report.html?weekStartRecent=true") + '" target="_blank">Report</a>').
			css('margin-left', '2px').addClass('agile_plus_header_link').appendTo(b);
	}

	checkCreateRecentFilter(b);
	if (url == "") {
		g_configData = null;
		g_bReadGlobalConfig = true;
		onReadGlobalConfig(g_configData, userElem);
		g_tipUserTopReport = "Warning: No sync configured!";
		return;
	}

	sendExtensionMessage({ method: "getConfigData", userTrello: userElem, urlService: url, bSkipCache: bSkipConfigCache },
		function (respConfig) {

			if (!bSkipConfigCache && respConfig.config.userTrello !== undefined && respConfig.config.userTrello != userElem) {
				//happens if users share the same chrome user (or no user). We detect if data is from another user. if so clear all storage
				//note: respConfig.config.userTrello is undefined when configData is in an intermediate state. will get refreshed below when it detects new version.
				clearAllStorage(function () {
					//Need to refresh the cached g_configData
					configureSsLinksWorker(b, url, true); //reload all
				});
				return;
			}

			if (respConfig.config.status != "OK") {
				setTimeout(function () {
					//set error text later, to avoid cases when user navigates back/away while on this xhr call.
					setSyncErrorStatus(urlUserElem, respConfig.config.status);
				}, 500);
				return;
			}

			g_configData = respConfig.config; //cache
			g_bReadGlobalConfig = true;
			onReadGlobalConfig(g_configData, userElem);
			configureSsLinksAdmin(respConfig, b);
			urlUserElem.attr("title", g_tipUserTopReport);
		});
}

var g_bDidInitialIntervalsSetup = false;

function initialIntervalsSetup() {
	spentTotal = InfoBoxFactory.makeTotalInfoBox(SPENT);
	estimationTotal = InfoBoxFactory.makeTotalInfoBox(ESTIMATION);
	remainingTotal = InfoBoxFactory.makeTotalInfoBox(REMAINING);

	doAllUpdates();
	detectMovedCards();
	var oldLocation = location.href;
	setInterval(function () {
		if (location.href != oldLocation) {
			oldLocation = location.href;
			setTimeout(function () { doAllUpdates(); }, 100); //breathe
		}
	}, 100); //check often, its important to prevent a big layout jump (so you can click on boards right away on home without them jumping (used to be more important before new trello 2014-01)

	setInterval(function () {
		doAllUpdates();
	}, UPDATE_STEP);
}

function onReadGlobalConfig(configData, user) {
	g_bShowBoardMarkers = false;

	if (isBackendMode(configData))
		g_bShowBoardMarkers = true;
	var pair = {};
	pair[PROP_SHOWBOARDMARKERS] = g_bShowBoardMarkers;
	chrome.storage.local.set(pair, function () { });

	//REVIEW zig: need a new way to notify of new service url/spreadsheet archiving (like a row with special meaning)
	startOpenDB(configData, user);
}

function setSyncErrorStatus(urlUser, status) {
	removeWeekSummaryProgress(urlUser);
	if (status == "OK") {
		var dateNow = new Date();
		var strLastSync = "Last sync OK @" + dateNow.toLocaleTimeString();
		if (g_tipUserTopReport.length > 0)
			strLastSync = strLastSync+". "+g_tipUserTopReport;
		urlUser.attr("title", strLastSync);
		urlUser.removeClass("agile_plus_header_error");
	} else {
		urlUser.attr("title", status);
		urlUser.addClass("agile_plus_header_error");
	}
}

var g_intervalSync = null;
var g_dbOpened = false;
var g_idTimeoutReportHover = null;

function startOpenDB(config, user) {
	g_dbOpened = false;
	sendExtensionMessage({ method: "openDB" },
			function (response) {
				if (response.status != "OK")
					return;
				g_cRowsHistoryLast = response.cRowsTotal;
				g_dbOpened = true;
				onDbOpened();
				doWeeklyReport(config, user);
				if (config != null)
					setTimeout(function () { doSyncDB(config, user, true); }, 1000); //wait a little so trello itself can load fully. Not needed but may speed up loading trello page.
				if (g_intervalSync != null) {
					clearInterval(g_intervalSync);
					g_intervalSync = null;
				}

				var urlUser = $("#urlUser");

				//Note: why use javascript handlers instead of css hover?
				//we want to cover a common case that css hover cant do: if a user using the mouse aiming towards the Plus help icon,
				//and she hovers over the weekly report on her way, as soon as she hover out of the report it will shrink and the plus icon will
				//keep moving away. Thus, here we delay the mouseout by 2 seconds so it gives her time to reach the plus icon.
				function handlerIn(event) {
					zoomTopReport(urlUser);
				}

				function handlerOut(event) {
					programUnZoom(urlUser);
				}

				urlUser.unbind("hover");
				urlUser.hover(handlerIn, handlerOut);

				if (config != null) {
					g_intervalSync = setInterval(function () { doSyncDB(config, user, true); }, g_msSyncPeriod);
					//review zig: these all should be at urlUser creation time to avoid the unbinds and such
					urlUser.unbind("click");
					urlUser.click(function () {
						g_tipUserTopReport = ""; //dont show it once the user clicks it.
						doSyncDB(config, user, false);
					});
				}
			});
}


function zoomTopReport(userElem) {
	if (g_idTimeoutReportHover) {
		//cancel ongoing. will be recreated on Out
		clearTimeout(g_idTimeoutReportHover);
		g_idTimeoutReportHover = null;
	}
	userElem.addClass("agile_plus_header_link_zoomhoverActive");
}

function programUnZoom(userElem) {
	if (g_idTimeoutReportHover == null) {
		g_idTimeoutReportHover = setTimeout(function () {
			userElem.removeClass("agile_plus_header_link_zoomhoverActive");
			g_idTimeoutReportHover = null;
		}, 2000);
	} else {
		//assert(false, "handlerOut should not have g_idTimeoutReportHover set."); //note: this can actually happen in rare cases involving switching windows while on the hover timeout wait
	}
}

var g_cRowsHistoryLast = 0;
var g_dateSyncLast = null;
var g_bFirstTimeUse = false;
var g_bIgnoreZeroECards = false;
var g_bAcceptSFT = false;
var g_bUserDonated = false;

function checkFirstTimeUse() {
	var keyDateLastSetupCheck = "dateLastSetupCheck";
	var keySyncWarn = "bDontShowAgainSyncWarn";

	var msDateNow = new Date().getTime();
	var bShowHelp = false;
	var totalDbRowsHistory = 0;
	sendExtensionMessage({ method: "getTotalDBRows" }, function (response) {
		if (response.status == "OK")
			totalDbRowsHistory = response.cRowsTotal;
		chrome.storage.local.get([keyDateLastSetupCheck, keySyncWarn], function (obj) {
			var valuekeySyncWarn = obj[keySyncWarn];
			var msDateLastSetupCheck = obj[keyDateLastSetupCheck];
			if (msDateLastSetupCheck !== undefined) {
				if (totalDbRowsHistory > 0 && g_strServiceUrl == "" && msDateNow - msDateLastSetupCheck > 1000 * 60 * 60 * 24 * 2) //nag every 2 days
					bShowHelp = true;
			}
			else if (g_strServiceUrl == "") {
				bShowHelp = true;
				g_bFirstTimeUse = true;
			}
			if (bShowHelp) {
				if (!valuekeySyncWarn) {
					var pair = {};
					pair[keyDateLastSetupCheck] = msDateNow;
					chrome.storage.local.set(pair, function () { });
					setTimeout(function () { Help.display(); }, 2000);
				}
			}
		});
	});
}

function onDbOpened() {
	if (!g_bDidInitialIntervalsSetup) {
		initialIntervalsSetup();
		g_bDidInitialIntervalsSetup = true;
	}
	checkFirstTimeUse();
}

function doSyncDB(config, user, bFromAuto) {
	if (PlusConfig.isVisible())
		return;

	var urlUser = $("#urlUser");

	sendExtensionMessage({ method: "getTotalDBRows" },
		function (response) {
			if (response.status != "OK")
				return;

			var cRowsOld = g_cRowsHistoryLast;
			g_cRowsHistoryLast = response.cRowsTotal;
			var bNewRows = (cRowsOld != g_cRowsHistoryLast);
			if (bNewRows) {
				g_bForceUpdate = true;
				doWeeklyReport(config, user, false);
			}

			var dateNow = new Date();
			if (bFromAuto) {
				if (document.webkitHidden)
					return; //sync only from active tab
			}
			
			if (!bNewRows && g_dateSyncLast != null && (dateNow.getTime() - g_dateSyncLast.getTime() < 1000 * 30)) {
				if (!bFromAuto) { //user clicked sync
					var str = "Plus syncs at most once every 30 seconds.";
					sendDesktopNotification(str, 3000); //prevent OCDs from consuming my api quota
				}
					return; //ignore request
				}
			

			function notifySyncBusy() {
				if (!bFromAuto) //user clicked sync
					sendDesktopNotification("Sync is busy. Plus will auto-retry in a few seconds.", 3000);
			}

			if (!setWeekSummaryProgress(urlUser)) {
				notifySyncBusy();
				return;
			}
			sendExtensionMessage({ method: "syncDB", config: config },
				function (response) {
					var bUpdateErrorState = true;
					if (response.status == "busy") {
						setSyncErrorStatus(urlUser, "OK");
						urlUser.attr("title", "Sync is busy.");
						notifySyncBusy();
						setTimeout(function () { doSyncDB(config, user, true); }, 10000); //wait a bit
						return;
					}
					g_dateSyncLast = dateNow;
					if (response.status != "OK") {
						setSyncErrorStatus(urlUser, response.status);
						return;
					}

					if (response.statusLastWriteSync != "OK") {
						bUpdateErrorState = false; //so it wont get overwritten below
						setSyncErrorStatus(urlUser, "Sync write error: " + response.statusLastWriteSync);

					}
					if (response.cRowsNew !== undefined && response.cRowsNew == 0) {
						if (bUpdateErrorState)
							setSyncErrorStatus(urlUser, response.status); //status is "OK"
						return; //nothing to update or create	
					}
					g_bForceUpdate = true;
					doWeeklyReport(config, user, bUpdateErrorState);
				});
		});
}

function doWeeklyReport(config, user, bUpdateErrorState) {
	fillCardSEStats($(".agile-se-stats")); //review zig: register for refresh notifications instead of hardcoding here all these
	var topbarElem = $("#help_buttons_container");
	var dateToday = new Date();
	var weekCur = getCurrentWeekNum();
	var dowToday = dateToday.getDay();
	var sToday = 0;
	if (weekCur != getCurrentWeekNum(dateToday))
		sToday = null; //means we are not tracking "today" because the week selection is not the current week.

	var sql = "select H.idCard, H.user,H.spent,H.est,H.comment,C.name as nameCard, strftime('%w',H.date,'unixepoch','localtime') as dow, H.date, B.name as nameBoard,H.eType from HISTORY H JOIN BOARDS B ON H.idBoard=B.idBoard JOIN CARDS C ON H.idCard=C.idCard where week=? order by user asc, date desc";
	var values = [weekCur];

	getSQLReport(sql, values,
		function (response2) {
			var curUser = getCurrentTrelloUser();
			//transform array so it has all week days
			var i = 0;
			var ordered = [];
			var drilldownData = [];
			var iCurrentUserOrder = -1; //might not be there
			if (response2.status == "OK") {
				for (; i < response2.rows.length; i++) {
					var row = response2.rows[i];
					if (row.user == null)
						continue; //table empty
					if (ordered.length == 0 || ordered[ordered.length - 1][0] != row.user) { //note must be ordered by user
						ordered.push([row.user, 0, 0, 0, 0, 0, 0, 0]);
						drilldownData.push([row.user, [], [], [], [], [], [], []]);
						if (iCurrentUserOrder < 0 && row.user == curUser)
							iCurrentUserOrder = ordered.length - 1;
					}
					var rowOrder = ordered[ordered.length - 1];
					var drillOrder = drilldownData[ordered.length - 1];
					var iCol = parseInt(row.dow,10) + 1;
					rowOrder[iCol] += row.spent;
					drillOrder[iCol].push(row);
				}

				for (i = 0; i < ordered.length; i++) {
					var row = ordered[i];
					var c = 1;
					for (; c < row.length; c++)
						row[c] = parseFixedFloat(row[c]); //reformat so charts dont have to
				}
			}

			var dataWeek = { config: config, status: response2.status, table: ordered, drilldownData: drilldownData };
			if (iCurrentUserOrder < 0)
				dataWeek.weekSummary = "no data";
			else {
				var sumDays = 0;
				var k = 1;
				var strDays = "";
				var rowUser = ordered[iCurrentUserOrder];
				for (; k < rowUser.length; k++) {
					if (rowUser[k] == 0)
						continue;
					sumDays += rowUser[k];
					var dow = k - 1;
					if (sToday !== null && dow == dowToday)
						sToday += rowUser[k];
					var curDay = getWeekdayName(dow) + ":" + rowUser[k];
					if (strDays.length != 0)
						strDays += " ";
					strDays += curDay;
				}

				dataWeek.weekSummary = parseFixedFloat(sumDays) + " " + strDays;
			}
			if (sToday === null)
				dataWeek.sToday = null;
			else
				dataWeek.sToday = parseFixedFloat(sToday);
			addWeekDataByBoard(dataWeek, weekCur, response2, function () {
				useWeeklyReportData(dataWeek, topbarElem, user, bUpdateErrorState);
			});
		});
}

function addWeekDataByBoard(dataWeek, weekCur, response, callback) {
	//note: this used to be a separate sql report, now it reuses passed response
	var i = 0;
	var ordered = [];
	var mapUsers = {};
	var users = [];
	var colUserLast = 0; //column for next new user
	var drilldownData = [];
				
	if (response.status == "OK") {
		//dataWeek is not ordered like we want, do so first
		var rows = response.rows;
		rows.sort(function (a, b) {
			var ret = a.nameBoard.localeCompare(b.nameBoard);
			if (ret != 0)
				return ret;
			ret = a.user.localeCompare(b.user);
			if (ret != 0)
				return ret;
			ret = a.date - b.date;
			return ret;
		});

		//transform array
		if (response.status == "OK") {
			for (; i < rows.length; i++) {
				var row = rows[i];
				if (row.user == null)
					continue; //review zig when does this happen, no data? (sql response status row)
				var columnUser = mapUsers[row.user];
				if (columnUser === undefined) {
					columnUser = ++colUserLast;
					mapUsers[row.user] = columnUser;
					users.push(row.user);
				}

				if (ordered.length == 0 || ordered[ordered.length - 1][0] != row.nameBoard) {
					ordered.push([row.nameBoard]);
					drilldownData.push([row.nameBoard]);
				}
				var rowOrder = ordered[ordered.length - 1]; //last one is current one
				var drillOrder = drilldownData[ordered.length - 1];
				while (rowOrder.length != colUserLast + 1) {
					rowOrder.push(0);
					drillOrder.push([]);
				}
				rowOrder[columnUser] += row.spent;
				drillOrder[columnUser].push(row);
			}

			for (i = 0; i < ordered.length; i++) {
				var rowOrder = ordered[i];
				var iCol = 1;
				for (; iCol < rowOrder.length; iCol++)
					rowOrder[iCol] = parseFixedFloat(rowOrder[iCol]); //format it here so charts dont have to
				while (rowOrder.length != colUserLast + 1)
					rowOrder.push(0);
			}
		}
	}
	dataWeek.byBoard = { table: ordered, status: response.status, users: users, drilldownData: drilldownData };
	callback();
}

function useWeeklyReportData(dataWeek, topbarElem, user, bUpdateErrorState) {
	configureSsLinksWorkerPostOauth(dataWeek, topbarElem, user, bUpdateErrorState);
	insertFrontpageCharts(dataWeek, user);
}


function insertHistoryRowFromUI(row) {
	sendExtensionMessage({ method: "insertHistoryRowFromUI", row: row }, function (response) {
		if (response.status != "OK") {
			alert("Insert error: " + response.status);
			return;
		}
	});
}

function getSQLReport(sql, values, callback) {
	getSQLReportShared(sql, values, callback, function onError(status) {
		setSyncErrorStatus($('#urlUser'), status);
	});
}

function configureSsLinksAdmin(resp, b) {
	if (resp.config === undefined)
		return;

	if (resp.config.urlAdmin !== undefined) {
		var urlAdminElem = $("#urlAdminElem");
		if (urlAdminElem.length == 0) {
			$('<a id="urlAdminElem" href="' + resp.config.urlAdmin + '" target="_blank">' + 'Admin</a>').
				css('margin-left', '5px').addClass('agile_plus_header_link').appendTo(b);
		} else {
			urlAdminElem.attr("href", resp.config.urlAdmin);
		}
	}
}

function getRecentWeeksList(elemUser) {
	var combo = $('<select id="spentRecentWeeks" />').addClass("agile_weeks_combo");//.css('margin-left','5px');
	combo.css('cursor', 'pointer');
	combo.attr("title","click to change the week being viewed.");
	var date = new Date();
	var dow = date.getDay();
	var i = 0;
	for (; i < 15; i++) {
		date.setDate(date.getDate() - dow);
		var text = getCurrentWeekNum(date);
		var title = date.toLocaleDateString();
		var dateEnd = new Date();
		dateEnd.setDate(date.getDate() + 6);
		title = title + " - " + dateEnd.toLocaleDateString();
		combo.append($(new Option(text, text)).addClass('agile_weeks_combo_element').attr("title",title));
		dow = 7;
	}
	
	combo.change(function () {
		if (!g_bReadGlobalConfig) {
			combo[0].selectedIndex = 0;
			return false;
		}
		combo.attr("title", "");
		var val = ($(this).val());
		g_weekNumUse = val;
		var userCur = getCurrentTrelloUser();
		var config = g_configData;
		if (userCur) { //review zig move up
			doWeeklyReport(config, userCur, true);
		}
	});

	return combo;
}


function getAllUsersList() {
	var combo = $('<select id="spentAllUsers" />').addClass("agile_users_combo");//.css('margin-left','5px');
	chrome.storage.local.get("allUsersSpent", function (obj) {
		var users = obj["allUsersSpent"];
		combo.css('cursor', 'pointer');
		combo.append($(new Option("Users", "")).addClass('agile_users_combo_element agile_users_combo_element_disabled').attr("disabled", "disabled"));
		if (users !== undefined) {
			var i = 0;
			for (i = 0; i < users.length; i++) {
				combo.append($(new Option(users[i][0], users[i][1])).addClass('agile_users_combo_element'));
			}
		}
		combo[0].selectedIndex = 0; //force it since its disabled
		combo.change(function () {
			var url = ($(this).val());
			$(this)[0].selectedIndex = 0;
			if (url != "") {
				url = "https://docs.google.com/spreadsheet/ccc?key=" + url;
				window.open(url, '_blank');
			}
		});
	});
	return combo;
}


var g_intervalBurnDown = null;

function configureSsLinksWorkerPostOauth(resp, b, user, bUpdateErrorState) {
	if (bUpdateErrorState === undefined)
		bUpdateErrorState = true;
	$(".agile_plus_burndown_link").hide();
	var urlUserElem = $('#urlUser');
	setupBurnDown(); //try right away, and try again in case trello changes the url without causing navigation
	if (g_intervalBurnDown == null)
		g_intervalBurnDown = setInterval(function () { setupBurnDown(); }, 200); //give it some time to load board fully


	if (resp.status != "OK") {
		if (bUpdateErrorState) {
			setTimeout(function () {
				//set error text later, to avoid cases when user navigates back/away while on this xhr call.
				setSyncErrorStatus(urlUserElem, resp.status);
			}, 100);
		}
		return;
	}

	processUserSENotifications(resp.sToday);
	var nameSsLink = resp.weekSummary;
	if (bUpdateErrorState)
		setSyncErrorStatus(urlUserElem, resp.status);
	urlUserElem.text(nameSsLink);
	if (resp.config)
		configureSsLinksAdmin(resp, b);
	insertPlusFeed(g_bCreatedPlusHeader);
	g_bCreatedPlusHeader = false;
}

function updateSsLinks() {
	doSyncDB(g_configData, getCurrentTrelloUser(), true);
}

var g_boardLastBurnDown = null; //needed for detecting if we need to update the link

function setupReportLink(idBoard) {
	var href = chrome.extension.getURL("report.html?weekStartRecent=true");
	if (idBoard)
		href += ("&idBoard=" + encodeURIComponent(idBoard));

	$("#urlReportElem").attr("href", href);
}

function setupBurnDown() {
	var board = getCurrentBoard();
	if (board == null || remainingTotal === undefined)
		return false;
	var burndownLink = $(".agile_plus_burndown_link");
	var idBoard = getIdBoardFromUrl(document.URL);
	if (idBoard == null) {
		if (g_boardLastBurnDown == board)
			burndownLink.show(); //show the already configured link. case: in board, show card. url changes so there is no idBoard.
		else
			setupReportLink(idBoard);
		return false;
	}
	setupReportLink(idBoard);
	g_boardLastBurnDown = board;
	if (burndownLink.length == 0) {
		burndownLink = $('<a title="Plus Dashboard" id="burndownLink" href="" target="_blank">Dashboard</a>').addClass("agile_plus_burndown_link");
		if (g_bNewTrello)
			burndownLink.css('color', 'white');
	}
	burndownLink.attr("href", chrome.extension.getURL("dashboard.html") + "?board=" + encodeURIComponent(board) + "&idBoard=" + encodeURIComponent(idBoard));
	burndownLink.show();
	burndownLink.insertAfter(remainingTotal);
	return true;
}


function processUserSENotifications(sToday) {
	if (sToday === null)
		return;
	try {
		var dtToday = new Date();
		var key = "spentLastNotified";
		var strToday = makeDateOnlyString(dtToday);
		chrome.storage.local.get(key, function (obj) {
			var value = obj[key];
			if (value != null) {
				if (strToday == value.strToday && sToday == value.sToday)
					return;
			}
			var pair = {};
			pair[key] = { strToday: strToday, sToday: sToday };
			chrome.storage.local.set(pair, function (obj) { });
			sendDesktopNotification("Spent today: " + sToday, 4000);
		});

	} catch (e) {
		//nothing
	}
}

function insertFrontpageCharts(dataWeek, user) {
	var mainDiv = $("#content");
	insertFrontpageChartsWorker(mainDiv, dataWeek, user);
}

function insertFrontpageChartsWorker(mainDiv, dataWeek, user) {
	//reset. Note case when navigating from board to home through trello logo, wont cause navigation
	if (document.URL.toLowerCase() != "https://trello.com/") {
		g_chartsCache = {};
		return false;
	}


	var divMainBoardsContainer = $(g_bNewTrello ? ".member-boards-view" : ".member-detail-modal");
	if (divMainBoardsContainer.length == 0) {
		setTimeout(function () { insertFrontpageChartsWorker(mainDiv, dataWeek, user); }, 200); //wait until trello loads that div
		return false;
	}

	var classContainer = "agile_spent_items_container";
	var container = $("." + classContainer);
	var idChartModuleSpentWeekUsers = "spent_week_users";
	var idChartModuleSpentWeekBoard = "spent_week_board";
	var idRecentModule = "spent_recent_cards";
	var idPendingModule = "spent_pending_cards";
	var strPostfixStatus = "_status";

	if (container.length == 0) {
		var divSpentItems = $('<div></div>').addClass(classContainer);
		if (g_bNewTrello) {
			divSpentItems.addClass("agile_spent_items_cont_newtrello");
		}
		var divInsertAfter = null;

		if (g_bNewTrello)
			divInsertAfter = $(".window-module").eq(0);
		else
			divInsertAfter = $(".window-sidebar");
		divSpentItems.insertAfter(divInsertAfter);
		var tableSpentItems = $('<table id="idTableSpentItemsHome" border="0" cellpadding="0" cellspacing="0"></table>');
		var row1 = $('<tr></tr>');
		var row2 = $('<tr></tr>');
		tableSpentItems.append(row1);
		tableSpentItems.append(row2);
		divSpentItems.append(tableSpentItems);
		var cellA = $('<td />');
		var cellB = $('<td />');
		row1.append(cellA);
		row1.append(cellB);
		var cellC = $('<td />');
		var cellD = $('<td />');
		row2.append(cellC);
		row2.append(cellD);
		chartModuleLoader(cellA, "Week by user", idChartModuleSpentWeekUsers, idChartModuleSpentWeekUsers + strPostfixStatus, dataWeek, loadChartSpentWeekUser, "left");
		chartModuleLoader(cellB, "Week by board", idChartModuleSpentWeekBoard, idChartModuleSpentWeekBoard + strPostfixStatus, dataWeek.byBoard, loadChartSpentWeekBoard, "left");
		var divItemDashboardRecent = addModuleSection(cellC, "Recently reported cards", idRecentModule, true, "left");
		var divItemDashboardUnspent = addModuleSection(cellD, "Pending balance cards", idPendingModule, true, "left");
		loadDashboards(divItemDashboardRecent, divItemDashboardUnspent, user);
	} else {
		var divItemDashboardRecent = $("#" + idRecentModule);
		var divItemDashboardUnspent = $("#" + idPendingModule);
		loadChartSpentWeekUser(idChartModuleSpentWeekUsers, idChartModuleSpentWeekUsers + strPostfixStatus, dataWeek);
		loadChartSpentWeekBoard(idChartModuleSpentWeekBoard, idChartModuleSpentWeekBoard + strPostfixStatus, dataWeek.byBoard);
		loadDashboards(divItemDashboardRecent, divItemDashboardUnspent, user);
	}
	return true;
}

function chartModuleLoader(divSpentItems, title, idChartModule, idElemChartStatus, data, callback, strFloat) {
	var divItem = addModuleSection(divSpentItems, title, idChartModule, false, strFloat);
	divItem.attr("align", "center");

	var nameLocal = idChartModule + "-Height";
	chrome.storage.local.get(nameLocal, function (obj) {
		var heightLast = obj[nameLocal];
		if (heightLast === undefined)
			heightLast = "50px";
		divItem.css("height", heightLast);
		callback(idChartModule, idElemChartStatus, data);
	});
}

function addModuleSection(div, name, id, bHidden, strFloat) {
	if (bHidden === undefined)
		bHidden = false;
	var divModule = $("<DIV>");
	var divTitleContainer = $("<DIV>").addClass("agile_spent_item_title");
	if (g_bNewTrello) {
		divTitleContainer.addClass("agile_spent_item_title_newTrello"); //fix width
		divModule.addClass("agile_module_newtrello");
		if (strFloat)
			divModule.css("float", strFloat);
	}
	else
		divModule.addClass("window-module"); //from trello
	var spanIcon = $("<span>");
	var icon = $("<img>").attr("src", chrome.extension.getURL("images/iconspent.png"));
	icon.addClass("agile-spent-icon-shifted");
	spanIcon.append(icon);
	divTitleContainer.append(spanIcon);
	divTitleContainer.append($('<h3>').text(name));
	divModule.append(divTitleContainer);
	var divItem = $('<div id="' + id + '"></div>').addClass("agile_spent_item");
	if (g_bNewTrello)
		divItem.addClass("agile_spent_item_newTrello");
	divModule.append(divItem);
	if (bHidden)
		divModule.hide();
	div.append(divModule);
	return divItem;
}

function doRecentReport(elemRecent, user) {
	var sql = "select datetime(H.date,'unixepoch','localtime') as dateLocal, B.name as nameBoard, C.name as nameCard, H.spent, H.est, H.comment, H.idCard \
				from HISTORY AS H \
				JOIN BOARDS AS B ON H.idBoard=B.idBoard \
				JOIN CARDS AS C ON H.idCard=C.idCard \
				WHERE H.user=? \
				ORDER BY date DESC LIMIT 10";
	var values = [user];
	getSQLReport(sql, values,
		function (response) {
			elemRecent.find($("ul")).remove();
			var list = $("<ul>");
			if (!g_bNewTrello)
				list.addClass("board-list");
			elemRecent.append(list);

			handleLoadRecent(list, response.rows);
			elemRecent.parent().show();
		});
}


function doPendingReport(elemPending, user) {
	var sqlNegativeDiff = (g_bIgnoreZeroECards ? "( CB.diff<-0.005 AND CB.est != 0 )" : "CB.diff<-0.005");
	var sql = "select CB.user, CB.spent, CB.est, CB.diff, datetime(CB.date,'unixepoch','localtime') as dateLocal, B.name as nameBoard, C.name as nameCard, C.idCard, \
					CB.date*1000 AS msDate, CB.diff  \
					FROM CARDBALANCE AS CB join CARDS AS C ON CB.idCard=C.idCard \
					jOIN BOARDS B ON B.idBoard=C.idBoard \
					WHERE CB.user=? AND ("+ sqlNegativeDiff + " OR CB.diff>0.005 OR CB.spent<-0.005 OR CB.est<-0.005) \
					ORDER BY CB.date DESC";
	var values = [user];
	getSQLReport(sql, values,
		function (response) {
			elemPending.find($("ul")).remove();
			var list = $("<ul>");
			if (!g_bNewTrello)
				list.addClass("board-list");
			elemPending.append(list);

			handleLoadPending(list, response.rows);
			elemPending.parent().show();
		});
}

function loadDashboards(elemRecent, elemUnspent, user) {
	if (!g_bReadGlobalConfig) {
		logPlusError("unusual: loadDashboards not ready.");
		return;
	}

	doRecentReport(elemRecent, user);
	doPendingReport(elemUnspent, user);
}

function addDashboardListItem(list, name, url, badge, tooltip, color) {
	var li = $("<li>");
	var a = $("<a>").addClass("agile-card-listitem").attr("href", url);
	if (!g_bNewTrello)
		a.addClass("js-open-board");
	else
		a.css("text-decoration", "none");

	var span = $("<span>").addClass("item-name").text(name);
	if (g_bNewTrello)
		span.addClass("agile-lineitem_newTrello");
	if (color !== undefined && color != null)
		span.css('color', color);
	if (badge !== undefined && badge != null) {
		badge.css('color', color);
		a.append(badge);
	}
	if (tooltip !== undefined)
		a.attr('title', tooltip);
	a.append(span);
	li.append(a);
	list.append(li);
	return span;
}

function handleLoadRecent(listElem, data) {
	var i = 0;
	for (; i < data.length; i++) {
		var row = data[i];
		if (row.dateLocal == null)
			break;
		var url = "https://trello.com/c/" + row.idCard;
		var tooltip = "" + row.dateLocal + "\nS:" + row.spent + " E:" + row.est + "\n" + row.comment;

		addDashboardListItem(listElem, strTruncate(row.nameBoard) + " - " + strTruncate(row.nameCard), url, null, tooltip);
	}
}

function handleLoadPending(listElem, data) {
	var i = 0;
	for (; i < data.length; i++) {
		var row = data[i];
		if (row.dateLocal == null)
			break;
		var url = "https://trello.com/c/" + row.idCard;
		var cDays = dateDiffInDays(new Date(), new Date(row.msDate));
		var tooltip = "Last reported " + cDays;

		if (cDays == 1)
			tooltip += " day ago.";
		else
			tooltip += " days ago.";

		var bError = false;
		if (row.spent < -0.005) {
			tooltip += " Error! negative total spent in this card.";
			bError = true;
		} else if (row.est < -0.005) {
			tooltip += " Error! negative total estimate in this card.";
			bError = true;
		} else if (row.diff < -0.005) {
			tooltip += " Error! negative remaining in this card. You must increase its Estimate.";
			bError = true;
		}

		var badge = BadgeFactory.makeRemainingBadge();
		badge.contents().last()[0].textContent = parseFixedFloat(row.diff);
		var color = null;
		if (cDays > 5)
			color = "darkgray";
		var span = addDashboardListItem(listElem, strTruncate(row.nameBoard) + " - " + strTruncate(row.nameCard), url, badge, tooltip, color);
		if (bError)
			span.addClass("agile_card_error");
	}
}

function handleLoadUnspent(listElem, data) {
	var i = 0;
	for (i = 12; ; i++) {
		if (i >= data.length)
			break;
		var row = data[i];
		if (row[1] == "" || row[1] == "--")
			break;
		var badge = BadgeFactory.makeRemainingBadge();
		badge.contents().last()[0].textContent = data[i][3];
		var tooltip = "Last reported: " + row[4] + (row[4] == "1" ? " day ago." : " days ago.");
		var color = null;
		if (row[4] > 5)
			color = "darkgray";
		addDashboardListItem(listElem, data[i][1] + " - " + data[i][2], data[i][5], badge, tooltip, color);
	}
}

function dateDiffInDays(a, b) {
	// Discard the time and time-zone information.
	var utc1 = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
	var utc2 = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());

	return Math.floor((utc1 - utc2) / (1000 * 60 * 60 * 24));
}

var g_chartsCache = {};
function loadChartSpentWeekUser(idElem, idElemStatusChart, response) {
	if (!g_bReadGlobalConfig) {
		logPlusError("unusual: loadChartSpentWeekUser not ready.");
		return;
	}

	var elem = $("#" + idElem);
	if (elem.length == 0)
		return;
	var icon = elem.parent().find(".agile-spent-icon-shifted");
	if (response.status != "OK" || response.table === undefined || response.table.length == 0) {
		if (response.status != "OK")
			icon.attr("title", response.status);
		elem.hide();
		return;
	} else
		elem.show();

	var rows = response.table;
	var data = new google.visualization.DataTable();
	var iDay = 0;
	data.addColumn('string', 'Who');
	for (; iDay < 7; iDay++) {
		data.addColumn('number', getWeekdayName(iDay));
	}

	var mapRows = addSumToRows(false, rows);
	data.addRows(rows);
	finishSpentChartConfig(idElem, elem, data, "top", 100, 0, response.drilldownData, "User", false, mapRows);
}



function getHtmlDrillDownTooltip(rows, bReverse, colExclude) {
	var headerBase = [{ name: "Date" }, { name: "User" }, { name: "Board" }, { name: "Card" }, { name: "S" }, { name: "E" }, { name: "Comment", bExtend: true }, { name: COLUMNNAME_ETYPE }];

	var header = [];
	var iHeader = 0;
	for (; iHeader < headerBase.length; iHeader++) {
		if (headerBase[iHeader].name != colExclude)
			header.push(headerBase[iHeader]);
	}

	function callbackRowData(row) {
		var rgRet = [];
		var date = new Date(row.date * 1000); //db is in seconds
		rgRet.push({ name: date.toDateString(), bNoTruncate: true });
		if (colExclude!="User")
			rgRet.push({ name: row.user, bNoTruncate: false });
		if (colExclude != "Board")
			rgRet.push({ name: row.nameBoard, bNoTruncate: false });
		var urlCard = null;
		if (row.idCard.indexOf("https://") == 0)
			urlCard = row.idCard; //old-style card URLs. Could be on old historical data from a previous Spent version
		else
			urlCard = "https://trello.com/c/" + row.idCard;
		rgRet.push({ name: "<A target='_blank' href='" + urlCard + "'>" + strTruncate(row.nameCard) + "</A>", bNoTruncate: true });
		rgRet.push({ name: parseFixedFloat(row.spent), bNoTruncate: true });
		rgRet.push({ name: parseFixedFloat(row.est), bNoTruncate: true });
		rgRet.push({ name: row.comment, bNoTruncate: false });
		rgRet.push({ name: nameFromEType(row.eType), bNoTruncate: true });
		if (row.comment.length > g_cchTruncateDefault)
			rgRet.title = row.comment;
		return rgRet;
	}

	return getHtmlBurndownTooltipFromRows(true, rows, bReverse, header, callbackRowData);
}

function loadChartSpentWeekBoard(idElem, idElemStatusChart, response) {
	//review zig idElemStatusChart and in byUser unused
	if (!g_bReadGlobalConfig) {
		logPlusError("unusual: loadChartSpentWeekBoard not ready.");
		return;
	}

	var elem = $("#" + idElem);
	if (elem.length == 0)
		return;
	var icon = elem.parent().find(".agile-spent-icon-shifted");
	if (response.status != "OK" || response.table === undefined || response.table.length == 0) {
		if (response.status != "OK")
			icon.attr("title", response.status);
		elem.hide();
		return;
	} else
		elem.show();

	var rows = response.table;
	var data = new google.visualization.DataTable();
	var iUser = 0;
	data.addColumn('string', 'Board');
	for (; iUser < response.users.length; iUser++)
		data.addColumn('number', response.users[iUser]);

	var mapRows = addSumToRows(false, rows);
	data.addRows(rows);
	finishSpentChartConfig(idElem, elem, data, "none", 150, 0, response.drilldownData, "Board",true, mapRows);
}

function finishSpentChartConfig(idElem, elem, data, posLegend, pxLeft, pxRight, drilldowns, colExclude, bReverse, mapRows) {
	var height = ((1 + data.getNumberOfRows()) * g_heightBarUser);
	if (posLegend == "top" || posLegend == "bottom")
		height += g_marginLabelChart;
	elem.css("height", "" + height);

	var chartParams = g_chartsCache[idElem];
	if (chartParams === undefined) {
		var chartNew = new google.visualization.BarChart(elem[0]);
		chartParams = { chart: chartNew, data: data, posLegend: posLegend, pxLeft: pxLeft, pxRight: pxRight };
		g_chartsCache[idElem] = chartParams;
		google.visualization.events.addListener(chartNew, 'animationfinish', function (e) {
			handleRemapLabels(chartParams);
		});
	}
	chartParams.data = data;
	chartParams.posLegend = posLegend;
	chartParams.pxLeft = pxLeft;
	chartParams.pxRight = pxRight; //NOTE: not used. gcharts dont support 'right'
	chartParams.mapRows = mapRows;
	chartParams.elemChart = elem[0];
	if (drilldowns) {
		chartParams.chart.setAction({
			id: 'drilldown',				  // An id is mandatory for all actions.
			text: 'Drill-down',	   // The text displayed in the tooltip.
			action: function () {		   // When clicked, the following runs.
				handleDrilldownWindow(chartParams.chart, drilldowns, getHtmlDrillDownTooltip, colExclude, 1100, bReverse);
				drawSpentWeekChart(chartParams);
			}
		});

		chartParams.chart.setAction({
			id: 'close-drilldown',				  // An id is mandatory for all actions.
			text: 'Close',	   // The text displayed in the tooltip.
			action: function () {		   // When clicked, the following runs.
				drawSpentWeekChart(chartParams);
			}
		});
	}

	drawSpentWeekChart(chartParams);
	var pair = {};
	var nameLocal = idElem + "-Height";
	pair[nameLocal] = height;
	chrome.storage.local.set(pair, function () { });
}

function redrawAllCharts() {
	var i = null;
	var chartsParams = g_chartsCache;
	for (i in chartsParams) {
		var cp = chartsParams[i];
		drawSpentWeekChart(cp);
	}
}

function updateUsersList(users) {
	users.sort(
		function (aParam, bParam) {
			var a = aParam[0];
			var b = bParam[0];
			if (a > b)
				return 1;
			if (a < b)
				return -1;
			return 0;
		}
	);

	//chrome.storage.local.remove("allUsersSpent");
	//return;
	var pair = {};
	pair["allUsersSpent"] = users;
	chrome.storage.local.set(pair, function (obj) {

	}
	);
}

function getWeekdayName(num) {
	return g_rgiDayName[num];
}


function drawSpentWeekChart(chartParams) {
	var chart = chartParams.chart;
	var data = chartParams.data;
	var posLegend = chartParams.posLegend;
	var pxLeft = chartParams.pxLeft;
	var pxRight = chartParams.pxRight;
	var mapRows = chartParams.mapRows;
	var elemChart = chartParams.elemChart;

	var top = 0;
	var bottom = 0;
	var right = 0;

	if (posLegend == "top")
		top = g_marginLabelChart;
	else if (posLegend == "bottom")
		bottom = g_marginLabelChart;

	var style = {
		chartArea: { left: pxLeft, top: top, bottom: bottom, right: 0, height: data.getNumberOfRows() * g_heightBarUser, width: "100%" },
		tooltip: { isHtml: true, trigger: 'selection' },
		vAxes: [{
			useFormatFromData: true,
			minValue: null,
			viewWindowMode: null,
			viewWindow: null,
			maxValue: null,
			titleTextStyle: {
				color: "#222",
				fontSize: 9,
				italic: true
			},
			textStyle: {
				color: "#222",
				fontSize: 9
			}
		},
		{
			useFormatFromData: true
		}],
		series: {
			0: {
				errorBars: {
					errorType: "none"
				}
			}
		},
		booleanRole: "certainty",
		animation: {
			duration: 330,
			easing: "in"
		},
		backgroundColor: {
			fill: g_bNewTrello ? "#FFFFFF" : "#F0F0F0"
		},
		legend: posLegend,
		hAxis: {
			useFormatFromData: false,
			formatOptions: {
				source: "inline",
				suffix: "h"
			},
			slantedText: false,
			minValue: null,
			format: "0.##'h'",
			viewWindow: {
				max: null,
				min: null
			},
			logScale: false,
			gridlines: {
				count: 4
			},
			maxValue: null,
			titleTextStyle: {
				color: "#222",
				fontSize: 9,
				italic: true
			},
			textStyle: {
				color: "#222",
				fontSize: 9
			}
		},
		isStacked: true,
		legendTextStyle: {
			color: "#222",
			fontSize: 9
		}
	};
	chart.draw(data, style);
	handleRemapLabels(chartParams);
}

function removePostfix(str, postfix) {
	if (postfix.length == 0)
		return str;
	var iDots = str.indexOf(postfix);
	if (iDots<0 || iDots + postfix.length != str.length)
		return str;
	return str.substr(0, iDots);
}

function remapTextElements(value, postfix, svg, mapRows, mapDone) {

	if (mapDone[value] == true)
		return;

	var elem = svg.eq(0).find("text").filter(function () {
		var valElem = removePostfix(this.innerHTML, postfix);
		if (valElem == value)
			return true;
		if (postfix.length == 0 || this.innerHTML==valElem)
			return false;
		return (value.indexOf(valElem) == 0);
	});

	if (elem.length != 1) {
		//corner case: if there are 2 boards with long names that are equal when cropped,
		//we cant tell which is which so we skip the calc instead of miscalculating
		return;
	}

	//jquery does not work on svg elements (jan 2014) so use the DOM api
	var elemSub = elem[0];
	var val = elemSub.textContent;
	elemSub.textContent = mapRows[value] + " " + removePostfix(elemSub.textContent,postfix);
	mapDone[value] = true;
}


/* handleRemapLabels
 *
 * Why is this needed?
 * Google charts support animations which we use. When we do, charts use the row name to match old with new data.
 * If we were to directly change the row labels when setting the chart data, animations wont match correctly the rows,
 * thus we instead hack the chart svg and change the labels ourselves.
 * For this to work, you need to call this function BOTH from your chart.draw AND from 'animationfinish' chart event.
 **/
function handleRemapLabels(chartParams) {
	if (chartParams.mapRows) {
		var mapDone = {};
		var svg = $(chartParams.elemChart).find("svg");
		if (svg.length == 0)
			return;

		for (var iMap in chartParams.mapRows) {
			remapTextElements(iMap, "", svg, chartParams.mapRows, mapDone);
		}
		
		//2nd pass to cover ellipsed labels (long labels ending with ...)
		for (var iMap in chartParams.mapRows) {
			remapTextElements(iMap, "...", svg, chartParams.mapRows, mapDone);
		}
	}
}

var g_current_fontSize = null; //cache for setSmallFont

function setMediumFont(elem) {
	return setSmallFont(elem, 0.9);
}

function setSmallFont(elem, percent) {
	var percentUse = percent;
	if (percent === undefined)
		percent = 0.7;
	if (g_current_fontSize == null)
		g_current_fontSize = parseInt($("body").css("font-size"), 10);
	elem.css("font-size", (g_current_fontSize * percent).toFixed() + "px");
	return elem; //for chaining
}

function setNormalFont(elem) {
	return setSmallFont(elem, 1);
}

function checkEnableMoses() {
	if (g_bNewTrello)
		return true;

	var content = $("#content");
	var classHomeContent = "agile_maincontent_margin";

	if (document.URL.toLowerCase() == "https://trello.com/")
		content.addClass(classHomeContent); //do the Moses move.
	else {
		if (content.hasClass(classHomeContent) && $(".agile_spent_items_container").length > 0)
			return false; //call again
		content.removeClass(classHomeContent);
	}
	return true;
}


function doShowAgedCards(bShow) {
	var elems = $(".aging-level-3");

	if (bShow)
		elems.show();
	else
		elems.hide();
}

var g_bShowAllItems = false;  //show all items, or recent only (cards and boards)

function checkCreateRecentFilter(header) {
	var elemFilter = header.find($("#toggleAll"));
	if (elemFilter.length > 0)
		return;
	var elem = $('<a id="toggleAll" href="">...</a>').
			css('margin-left', '5px').addClass('agile_plus_header_link').appendTo(header);


	//var elem=$('<span>Less</span>', { id:'toggleAll'}).addClass("agile_all_button").addClass("header-btn").addClass("header-notifications");
	elem.css('cursor', 'pointer');
	elem.attr("title", "Click to show/hide old boards and cards.");
	header.append(elem);
	updateShowAllButtonState(elem);
	elem.click(function (e) {
		elem.attr("title", ""); //dont show it anymore.
		e.preventDefault();
		//after set, we get again because set might have failed (over quota)
		chrome.storage.sync.set({ 'bShowAllItems': !g_bShowAllItems }, function () {
			if (chrome.runtime.lastError === undefined)
				updateShowAllButtonState(elem);
			else
				logPlusError("error checkCreateRecentFilter: " + chrome.runtime.lastError);
		});
	});
}

function updateShowAllButtonState(elem) {
	chrome.storage.sync.get("bShowAllItems", function (obj) {
		var bShow = obj["bShowAllItems"];
		if (bShow === undefined)
			bShow = true;
		g_bShowAllItems = bShow;

		if (bShow) {
			elem.removeClass("agile_all_unpressed");
			elem.addClass("agile_all_pressed");
		} else {
			elem.removeClass("agile_all_pressed");
			elem.addClass("agile_all_unpressed");
		}
		doShowAgedCards(bShow);
		updateBoardPageTotals();
		elem.text(bShow ? "Less" : "More");
	});
}



function testExtensionAndcommitPendingPlusMessages() {
	if (!g_bErrorExtension)
		testExtension(); //this attempts commit of pending queue
}