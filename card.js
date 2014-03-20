var g_inputSEClass = "agile_plus_addCardSE";
var g_strNowOption = "now";

function validateSEKey(evt) {
	var theEvent = evt || window.event;
	var key = theEvent.keyCode || theEvent.which;
	key = String.fromCharCode(key);
	var regex = /[0-9]|\.|\:|\-/;
	if (!regex.test(key)) {
		theEvent.returnValue = false;
		if (theEvent.preventDefault) theEvent.preventDefault();
	}
}


function createCardSEInput(spentParam, estimateParam, commentParam) {
	var bHasSpentBackend = isBackendMode();

	var container = $("<div></div>").addClass(g_inputSEClass);
	var containerStats = $("<table class='agile-se-bar-table agile-se-stats'></table>");
	var containerBar = $("<table class='agile-se-bar-table'></table>");
	container.append(containerStats);
	container.append(containerBar);
	var row = $("<tr></tr>").addClass("agile-card-background");
	containerBar.append(row);

	var comboDays = setSmallFont($('<select id="plusCardCommentDays"></select>').addClass("agile_days_box_input"));
	comboDays.attr("title", "How many days ago did it happen?");
	var iDays = 1;
	var iLast = 10;
	if (bHasSpentBackend)
		iLast = 2;
	comboDays.append($(new Option(g_strNowOption, g_strNowOption)));
	for (; iDays <= iLast; iDays++) {
		var txt = "-" + iDays + "d";
		comboDays.append($(new Option(txt, txt)));
	}
	var spinS = setNormalFont($('<input id="plusCardCommentSpent" placeholder="S" formnovalidate></input>').addClass("agile_spent_box_input"));
	spinS[0].onkeypress = function (e) { validateSEKey(e); };
	var spinE = setNormalFont($('<input id="plusCardCommentEstimate" placeholder="E"></input>').addClass("agile_estimation_box_input"));
	spinE[0].onkeypress = function (e) { validateSEKey(e); };
	var slashSeparator = setSmallFont($("<span />").text("/"));
	var comment = setNormalFont($('<input type="text" name="Comment" placeholder="Plus comment"/>').attr("id", "plusCardCommentComment").addClass("agile_comment_box_input"));

	var spanIcon = $("<span />");
	var icon = $("<img>").attr("src", chrome.extension.getURL("images/iconspent.png"));
	icon.attr('title', 'Add S/E to this card. Use negative numbers to reduce.');
	icon.addClass("agile-spent-icon-cardcommentSE");
	spanIcon.append(icon);

	var buttonEnter = setSmallFont($('<button id="plusCardCommentEnterButton"/>').addClass("agile_enter_box_input").text("Enter"));
	buttonEnter.attr('title', 'Click to enter this S/E.');
	row.append($('<td />').addClass("agile_tablecellItem").append(spanIcon));
	row.append($('<td />').addClass("agile_tablecellItem").append(comboDays));
	row.append($('<td />').addClass("agile_tablecellItem").append(spinS))
		.append($('<td />').addClass("agile_tablecellItem").append(slashSeparator))
		.append($('<td />').addClass("agile_tablecellItem").append(spinE))
		.append($('<td />').addClass("agile_tablecellItem").append(comment).width("100%")) //takes remaining hor. space
		.append($('<td />').addClass("agile_tablecellItemLast").append(buttonEnter));

	if (spentParam !== undefined)
		spinS.text(spentParam);

	if (estimateParam !== undefined)
		spinE.text(estimateParam);

	if (commentParam !== undefined)
		comment.text(commentParam);

	buttonEnter.click(function () {
		testExtension(function () {
			clearBlinkButtonInterval();
			buttonEnter.removeClass("agile_box_input_hilite");
			var s = parseSEInput(spinS);
			var e = parseSEInput(spinE);
			if (s == null || e == null)
				return;
			var prefix = comboDays.val();
			var valComment = comment.val().replace(/\[/g, '*').replace(/\]/g, '*');
			//use setTimeout to get out of the click stack. else it will conflict with out fake clicks.
			setTimeout(function () { setNewCommentInCard(s, e, valComment, prefix, true); }, 0);
		});
	});
	fillCardSEStats(containerStats);
	return setSmallFont(container);
}

function fillCardSEStats(containerStats) {
	if (containerStats.length == 0)
		return;
	var idCard = getIdCardFromUrl(document.URL);
	if (idCard == 0)
		return; //ignore

	var sql = "select CB.idCard, CB.user, CB.spent, CB.est \
				FROM CARDBALANCE AS CB \
				WHERE CB.idCard=? \
				ORDER BY CB.user";
	var values = [idCard];
	getSQLReport(sql, values,
		function (response) {
			containerStats.empty();
			containerStats.append($('<a href="' + chrome.extension.getURL("report.html?idCard=") + encodeURIComponent(idCard) + '" target="_blank">Card Report</a>'));
			if (response.status != "OK" || response.rows.length == 0)
				return;
			var i = 0;
			addCardSERowData(containerStats, { user: 'By User', spent: 'S', est: 'E' }, true);
			for (; i < response.rows.length; i++) {
				var rowData = response.rows[i];
				addCardSERowData(containerStats, rowData);
			}
		});
}

function addCardSERowData(containerStats, rowData, bHeader) {
	var row = $("<tr></tr>").addClass("agile-card-background").addClass("agile-card-statrow");
	if (bHeader)
		row.addClass("agile-card-background-header");
	var td = (bHeader ? '<th />' : '<td />');
	var u = null;
	if (bHeader)
		u = $(td).text(rowData.user);
	else {
		var urlReport = '<a href="' + chrome.extension.getURL("report.html?idCard=") + encodeURIComponent(rowData.idCard) + '&user=' + rowData.user + '" target="_blank">' + rowData.user + '</a>';
		u = $(td).html(urlReport);
	}
	var sVal = (typeof (rowData.spent) == 'string' ? rowData.spent : parseFixedFloat(rowData.spent));
	var eVal = (typeof (rowData.est) == 'string' ? rowData.est : parseFixedFloat(rowData.est));
	var s = $(td).text(sVal);
	var e = $(td).text(eVal);

	if (typeof (sVal) == "number") {
		if (sVal < 0 || sVal > eVal) {
			s.css('cursor', 'pointer');
			s.attr("title", sVal < 0 ? "Negative Spent!" : "Spent larger than Estimate!");
			s.css("background", "red");
		}
		if (eVal < 0) {
			e.css('cursor', 'pointer');
			e.attr("title", "Negative Estimate!");
			e.css("background", "red");
		}
	}
	row.append(u).append(s).append(e);
	containerStats.append(row);
}

function parseSEInput(ctl, bHiliteError) {
	if (bHiliteError===undefined)
		bHiliteError = true;
	if (bHiliteError)
		ctl.removeClass("agile_box_input_hilite");
	var val = ctl[0].value;
	if (val.indexOf(":") < 0)
		return parseFixedFloat(val);
	if (val.indexOf(".") >= 0) {
		if (bHiliteError)
			ctl.addClass("agile_box_input_hilite");
		return null; //invalid
	}
	var rg = val.split(":");
	if (rg.length != 2) {
		if (bHiliteError)
			ctl.addClass("agile_box_input_hilite");
		return null; //invalid
	}
	var h = rg[0];
	var sign = (h < 0 ? -1 : 1);
	h = Math.abs(h);
	var m = rg[1];

	return parseFixedFloat(sign * (parseFixedFloat(h) + parseFixedFloat(m / 60)));
}

function getAndSaveBoardId(boardName) {
	var key = getKeyForIdFromBoard(boardName);
	var url = document.URL + ".json";
	var xhr = new XMLHttpRequest();
	xhr.withCredentials = true; //review zig: not needed but might be chrome bug? placing it for future
	xhr.onreadystatechange = function (e) {
		if (xhr.readyState == 4) {
			if (xhr.status == 200) {
				try {
					//var boom = xhr.bam.bam; //to test exception handler 
					var obj = JSON.parse(xhr.responseText);
					var idBoardShort = obj.actions[0].data.board.shortLink;
					doSaveBoardValues({ idBoard: idBoardShort }, key);
				} catch (e) {
					logException(e, "Error: not able to parse board shortLink from card json response");
				}
			} else {
				logPlusError("Error: not able to deduce board shortLink from card url json");
			}
		}
	};

	xhr.open("GET", url);
	xhr.send();

}

function addCardCommentHelp() {
	if (!g_bReadGlobalConfig)
		return; //wait til later

	var elems = $(".add-controls");
	var elemsVerifyCardWindow = $(".card-detail-title");

	if (elemsVerifyCardWindow.length == 0)
		return;

	var i = 0;
	//create S/E bar if not there yet
	if ($("." + g_inputSEClass).length == 0) {
		$(".edits-warning").css("background", "yellow").attr('title', 'Plus: Make sure to enter this unsaved edits if they were made by Plus.');
		var board = getCurrentBoard();
		if (board == null)
			return; //wait til later
		var key = getKeyForIdFromBoard(board);
		chrome.storage.local.get(key, function (obj) {
			var value = obj[key];
			var bHide = true;
			if (value === undefined) {
				getAndSaveBoardId(board, document.URL);
			}
		});

		for (i = 0; i < elems.length; i++) {
			var elem = elems.eq(i);
			var elemParent = elem.parent();
			if (elemParent.hasClass("new-comment")) {
				var classSpentCommentHelp = "agile_plushelp_cardCommentHelp";
				if (isBackendMode() && elem.eq(0).children("." + classSpentCommentHelp).length == 0) {
					var help = setSmallFont($("<span>Spent: @" + getSpentSpecialUser() + " [-1d] S/E comment</span>").addClass(classSpentCommentHelp), 0.85);
					elem.append(help);
				}

				var spanInput = createCardSEInput();
				elemParent.before(spanInput);
				break;
			}
		}
	}

	var helpClass = "agile_plushelp_renamecardwarning";
	var saveBtn = $(".js-save-edit");

	if (saveBtn.length == 0)
		return;

	for (i = 0; i < saveBtn.length; i++) {
		var e = saveBtn.eq(i);

		var editControls = e.parent();
		if (!editControls.eq(0).hasClass("edit-controls"))
			continue;
		var elemFind = editControls.eq(0).parent();
		if (!elemFind.eq(0).hasClass("edit"))
			continue;
		elemFind = elemFind.eq(0).parent();
		if (!elemFind.eq(0).hasClass("card-detail-title"))
			continue;

		if (editControls.eq(0).children("." + helpClass).length == 0) {
			var help = setSmallFont($("<span>Plus: Do not change (S/E) unless you had pending commits.</span>").addClass(helpClass), 0.85);
			editControls.append(help);
		}
	}
}

var Card = {
	//
	// Separator used to split the custom values 
	// from the rest of the title
	//
	mainSeparator: ")",
	secondarySeparator: "/",
	startSeparator: "(",
	//
	// Parses the title to obtain the estimated number of units
	// E.g. "2--This is a string" will output the number 2.
	//
	hashtagsFromTitle: function (title) {
		var hashtags = [];
		var regexp = /#([\w-]+)/g;
		var result = regexp.exec(title);
		while (result != null) {
			hashtags.push(result[1]);
			result = regexp.exec(title);
		}

		return hashtags;
	},
	//
	// Return the clean version of the title, w/o the prefixes.
	// E.g. For "(2) This task rocks" this will give "This task rocks"
	// E.g. For "(1/2) This task rocks" this will give "This task rocks"
	//
	estimationLabelText: function (estimationNumber) {
		return "E: " + String(estimationNumber);
	},
	spentLabelText: function (spentNumber) {
		return "S: " + String(spentNumber);
	},
	remainingLabelText: function (number) {
		return "R: " + String(number);
	},
	titleTag: function (card) {
		var details = $(card).children('div.list-card-details');
		return details.eq(0).children('a.list-card-title').eq(0);
	}
};

function getCardTimerData(hash, resp) {
	chrome.storage.sync.get(hash, function (obj) {
		resp({ stored: obj[hash], hash: hash });
		return;
	});
}

function getCardTimerSyncHash(idCard) {
	return "timer:" + idCard;
}

function loadCardTimer(idCard) {
	var timerElem = $("<a></a>").addClass("button-link ").attr("id", "agile_timer").hide();
	var spanIcon = $("<span>");
	var icon = $("<img>").attr("src", chrome.extension.getURL("images/iconspent.png"));
	icon.addClass("agile-spent-icon-cardtimer");
	spanIcon.append(icon);
	spanIcon.appendTo(timerElem);
	var spanTextTimer = $("<span>");
	spanTextTimer.appendTo(timerElem);
	var hash = getCardTimerSyncHash(idCard);
	var timerStatus = { bRunning: false, idInterval: null, idCard: idCard };
	timerElem.click(function () {
		testExtension(function () {
			handleCardTimerClick(hash, timerElem, timerStatus, idCard);
		});
	});
	getCardTimerData(hash, function (obj) {
		hash = obj.hash;
		var stored = obj.stored;
		var msStart = 0;
		var msEnd = 0;
		if (stored !== undefined) {
			timerStatus.bRunning = (stored.msEnd == null);
			msStart = stored.msStart;
			if (timerStatus.bRunning) {
				configureTimerInterval(timerElem, timerStatus, msStart);
				var date = new Date();
				msEnd = date.getTime();
			}
			else
				msEnd = stored.msEnd;
		}
		updateTimerElemText(timerElem, msStart, msEnd);

		updateTimerTooltip(timerElem, timerStatus.bRunning, false, true);
		timerElem.show();
	});
	return timerElem;
}

function updateTimerTooltip(timerElem, bRunning, bRemoveSmallTimerHelp, bUpdateCards) {
	bRemoveSmallTimerHelp = bRemoveSmallTimerHelp || false;
	bUpdateCards = bUpdateCards || false;
	var title = "";
	var strClassRunning = "agile_timer_running";
	if (bRunning) {
		timerElem.addClass(strClassRunning);
		if (bRemoveSmallTimerHelp)
			title = "Click to stop the timer.";
		else
			title = "Click to stop the timer.\nTimers under 20 seconds are ignored.";
	}
	else {
		timerElem.removeClass(strClassRunning);
		title = "Click to start the timer.";
	}

	timerElem.attr('title', title);
	if (bUpdateCards) {
		var boardCur = getCurrentBoard();
		if (boardCur != null) {
			//setTimeout allows formatting above to happen faster
			setTimeout(function () { updateCards(boardCur); }, 50);
		}
	}
}

function isTimerRunningOnScreen(timer) {
	timer = timer || g_timerStatus;
	return (timer && timer.idInterval && timer.idCard && getIdCardFromUrl(document.URL) == timer.idCard);
}

var g_timerStatus = null;
function configureTimerInterval(timerElem, timerStatus, msStart) {
	g_timerStatus = timerStatus; //so we can tell when a timer is running
	timerStatus.idInterval = setInterval(function () {
		if (g_timerStatus && g_timerStatus.idInterval != timerStatus.idInterval) {
			//prevent multiple timers running. Last one wins. can happen because trello doenst reload page when going from card to board
			//review zig: should be where its created not here
			clearInterval(timerStatus.idInterval);
			timerStatus.idInterval = null;
			return;
		}

		var date = new Date();
		if (isTimerRunningOnScreen(timerStatus)) {
			var msEnd = date.getTime();
			updateTimerElemText(timerElem, msStart, msEnd);
			updateTimerTooltip(timerElem, true, msEnd - msStart > 20 * 1000, false);
		}
	}, 1000);
}

function updateTimerElemText(timerElem, msStart, msEnd) {
	var txt = "";
	var ms = 0;
	if (msStart != null)
		ms = msEnd - msStart;

	var divisor = 1000 * 60 * 60;
	var hours = Math.floor(ms / divisor);
	ms -= hours * divisor;
	divisor = 1000 * 60;
	var minutes = Math.floor(ms / divisor);
	ms -= minutes * divisor;
	divisor = 1000;
	var seconds = Math.floor(ms / divisor);

	txt = "" + hours + "h:" + minutes + "m:" + seconds + "s";
	timerElem.children().filter(':last-child').text(txt);
}

function handleCardTimerClick(hash, timerElem, timerStatus, idCard) {
	getCardTimerData(hash, function (obj) {
		hash = obj.hash;
		var stored = obj.stored;
		if (stored === undefined || (stored.msStart != null && stored.msEnd != null) ||
			(stored.msStart == null && stored.msEnd == null)) {
			stored = { msStart: (new Date()).getTime() + 100, msEnd: null };
			var objNew = {};
			objNew[hash] = stored;
			if (timerStatus.bRunning) { //uncommon case of having two card windows open, start timer from A, stop from B, stop again A
				timerStatus.bRunning = false;
				if (timerStatus.idInterval)
					clearInterval(timerStatus.idInterval);
				timerStatus.idInterval = null;
			}
			chrome.storage.sync.set(objNew, function () {
				if (chrome.runtime.lastError !== undefined)
					return;
				timerStatus.bRunning = true;
				updateTimerTooltip(timerElem, timerStatus.bRunning, false, true);
				configureTimerInterval(timerElem, timerStatus, stored.msStart);
			});
		}
		else if (stored.msStart != null && stored.msEnd == null) {
			//stop
			var msStartCur = stored.msStart;
			var msEndCur = (new Date()).getTime();
			chrome.storage.sync.remove(hash, function () {
				if (chrome.runtime.lastError !== undefined)
					return;
				timerStatus.bRunning = false;
				if (timerStatus.idInterval)
					clearInterval(timerStatus.idInterval);
				timerStatus.idInterval = null;

				updateTimerElemText(timerElem, msStartCur, msStartCur); //just so it shows 0:0
				updateTimerTooltip(timerElem, timerStatus.bRunning, false, true);

				var ms = msEndCur - msStartCur;
				var sUse = parseFixedFloat(ms / (1000 * 60 * 60));
				if (sUse != 0)
					addSEFieldValues(sUse, 0, "end timer. ");
			});
		}
	});
}

var g_intervalBlinkButton = null;
var g_cBlinkButton = 0;

function clearBlinkButtonInterval() {
	if (g_intervalBlinkButton != null)
		clearInterval(g_intervalBlinkButton);
	g_cBlinkButton = 0;
}

/* addSEFieldValues
 *
 * s,e: float
 * will add given s/e to existing values in the controls
 **/
function addSEFieldValues(s, e, comment) {
	var elemSpent = $("#plusCardCommentSpent");
	var elemEst = $("#plusCardCommentEstimate");
	var sCur = parseSEInput(elemSpent,false);
	var eCur = parseSEInput(elemEst, false);
	if (sCur == null)
		sCur=0;
	if (eCur == null)
		eCur=0;
	s = parseFixedFloat(s + sCur);
	e = parseFixedFloat(e + eCur);
	if (s == 0)
		s = "";
	if (e == 0)
		e = "";
	$("#plusCardCommentDays").val(g_strNowOption);
	elemSpent.val(s);
	elemEst.val(e);
	$("#plusCardCommentComment").val(comment);
	var elemEnter = $("#plusCardCommentEnterButton");
	var classBlink = "agile_box_input_hilite";
	elemEnter.focus().addClass(classBlink);
	clearBlinkButtonInterval();
	g_intervalBlinkButton = setInterval(function () {
		g_cBlinkButton++;

		if (elemEnter.hasClass(classBlink))
			elemEnter.removeClass(classBlink);
		else {
			elemEnter.addClass(classBlink);
			if (g_cBlinkButton > 2) //do it here to it remains yellow
				clearBlinkButtonInterval();
		}
	}, 500);
}

function setNewCommentInCard(s, e, commentBox, prefix, bFromSEControls) {
	if (prefix == g_strNowOption || prefix == null)
		prefix = "";
	var bNoSpentBackend = !isBackendMode();
	var bAlwaysEnter = (bFromSEControls == true);
	var comment = "";

	if (!bAlwaysEnter && s < 0.005)
		comment = "";
	else {
		s = Math.round(s * 100) / 100;
		e = Math.round(e * 100) / 100;
		if (bNoSpentBackend) {
			comment = "Plus S/E ";
			if (prefix.length > 0)
				comment = comment + " " + prefix + " ";
			comment = comment + s + "/" + e + " " + commentBox;
		}
		else
			comment = "@" + getSpentSpecialUser() + " " + (prefix === undefined ? "" : prefix + " ") + s + "/" + e + " " + commentBox;
	}

	if (comment == "" || (!bAlwaysEnter && s == 0 && e == 0))
		return;

	var board = getCurrentBoard();
	if (board == null) {
		logPlusError("error: no board");
		return; //should never happen, we had it when the S/E box was created
	}

	var key = getKeyForIdFromBoard(board);
	var idCardCur = getIdCardFromUrl(document.URL);
	if (idCardCur == 0) {
		logPlusError("error: no idCardCur");
		return; //should never happen
	}
	chrome.storage.local.get(key, function (obj) {
		var value = obj[key];
		var bHide = true;
		if (value === undefined) {
			//we started the xhr request to get it when card was loaded. If we still dont have it something is wrong.
			alert("Network error. Cant get idBoard.");
			return;
		}
		doEnterSEIntoCard(s, e, commentBox, comment, value.idBoard, idCardCur, prefix, board);
	});
}

function bHandleNoBackendDbEntry(s, e, commentBox, idBoard, idCard, strDays, strBoard, cleanTitle) {
	var dateNow = new Date();
	var userCur = getCurrentTrelloUser();
	if (userCur == null) {
		logPlusError("error: no trello user");
		return false; //should never happen, but be safe
	}

	var dDays = 0;
	if (strDays != "") {
		dDays = parseInt(strDays, 10);
		if (dDays != 0)
			dateNow.setDate(dateNow.getDate() + dDays);
	}

	helperInsertHistoryRow(dateNow, idCard, idBoard, strBoard, cleanTitle, userCur, s, e, commentBox);
	return true;
}

function helperInsertHistoryRow(dateNow, idCard, idBoard, strBoard, strCard, userCur, s, e, comment) {
	//console.log(dateNow + " idCard:" + idCard + " idBoard:" + idBoard + " card:" + strCard + " board:" + strBoard);
	var obj = {};
	var userForId = userCur.replace(/-/g, '~'); //replace dashes from username. should never happen since trello already strips dashes from trello username.
	obj.idRow = 'id' + dateNow.getTime() + userForId; //make up a unique 'notification' id across team members. start with a string so it will never be confused by a number in the ss

	obj.idCard = idCard;
	obj.idBoard = idBoard;

	var date = Math.floor(dateNow.getTime() / 1000); //seconds since 1970
	obj.date = date;
	obj.strBoard = strBoard;
	obj.strCard = strCard;
	obj.spent = s;
	obj.est = e;
	obj.user = userCur;
	obj.week = getCurrentWeekNum(dateNow);
	var nMonth = dateNow.getMonth() + 1;
	nMonth = getWithZeroPrefix(nMonth);
	obj.month = dateNow.getFullYear() + "-" + nMonth;
	obj.comment = comment;

	insertHistoryRowFromUI(obj);
}

function doEnterSEIntoCard(s, e, commentBox, comment, idBoard, idCard, strDays, strBoard) {
	var bNoSpentBackend = !isBackendMode();
	var elem = null;
	var titleCur = null;
	var cleanTitle = null;

	elem = $(".window-title-text");
	titleCur = elem.text();
	var se = parseSE(titleCur, true);
	cleanTitle = se.titleNoSE;

	if (bNoSpentBackend) {
		if (!bHandleNoBackendDbEntry(s, e, commentBox, idBoard, idCard, strDays, strBoard, cleanTitle))
			return;
	}

	setTimeout(function () {
		//force it because while the card window is up, we dont re-parse the board.
		g_bForceUpdate = true;
	}, 500);
	$("#plusCardCommentDays").val(g_strNowOption);
	$("#plusCardCommentSpent").val("");
	$("#plusCardCommentEstimate").val("");
	$("#plusCardCommentComment").val("");
	if (bNoSpentBackend && (s != 0 || e != 0)) {


		elemParent = elem.parent();
		//elem.click();
		var editTitleElem = elemParent.find("textarea");


		var estimation = parseFixedFloat(e + se.estimate);
		var spent = parseFixedFloat(s + se.spent);
		var valNew = null;

		if (se.bSFTFormat)
			valNew = "(" + estimation + ") " + cleanTitle + " [" + spent + "]";
		else
			valNew = "(" + spent + "/" + estimation + ") " + cleanTitle;
		editTitleElem.val(valNew);
		elem.click();
		setTimeout(function () {
			var btnClick = elem.parent().find($(".js-save-edit"));
			btnClick.click();
			handleEnterCardCommentAndClick(comment);
		}, 0);
	}
	else {
		handleEnterCardCommentAndClick(comment);
	}
}

function handleEnterCardCommentAndClick(comment) {
	var elem = $(".new-comment-input");
	var elemParent = elem.parent();
	//elemParent.click();
	//let click actions finish
	setTimeout(function () {
		elem.val(comment);
		var btnClick = elemParent.find($(".js-add-comment"));
		btnClick.click();
		setTimeout(function () { g_bForceUpdate = true; }, 500); //trigger a forced update in case autodetection fails (example when timer is running)
	}, 0);
}


/* parseSE
*
* bKeepHashTags defaults to false
* returns se:
* se.titleNoSE : string
* se.spent : float
* se.estimate : float 
*
*/
function parseSE(title, bKeepHashTags) {
	var se = { bParsed: false, bSFTFormat: false };

	if (g_bAcceptSFT)
		se = parseSE_SFT(title);

	if (se.bParsed) {
		se.bSFTFormat = true;
	} else {
		var patt = new RegExp("^([(]\\s*([+-]?[0-9]*[.]?[0-9]*)\\s*/\\s*([+-]?[0-9]*[.]?[0-9]*)\\s*[)])?\\s*(.+)$");
		var rgResults = patt.exec(title);

		//review zig: when is rgResults null? one user had this but never sent the offending card title
		if (rgResults == null || rgResults[2] === undefined || rgResults[3] === undefined) {
			se.spent = 0;
			se.estimate = 0;
			se.titleNoSE = title.trim();
			if (g_bAcceptSFT)
				se.bSFTFormat = true;
		} else {
			se.titleNoSE = rgResults[4].trim();
			se.spent = parseFixedFloat(rgResults[2]);
			se.estimate = parseFixedFloat(rgResults[3]);
		}
	}
	// Strip hashtags
	if (bKeepHashTags === undefined || bKeepHashTags == false)
		se.titleNoSE = se.titleNoSE.replace(/#[\w-]+/, "");
	return se;
}

function parseSE_SFT(title) {
	function makePatt(leftDelim, rightDelim) {
		var start = null;
		var end = null;
		if (leftDelim == "[") {
			start = "\\[";
			end = "\\]";
		}
		else {
			start = "[" + leftDelim + "]";
			end = "[" + rightDelim + "]";
		}
		return start + "(\\s*[+-]?[0-9]*[.]?[0-9]*\\s*)" + end;
	}

	var se = { bParsed: false };
	var leftDelim = "(";
	var rightDelim = ")";
	var part = makePatt(leftDelim, rightDelim);
	var patt = new RegExp("^.*?" + makePatt(leftDelim, rightDelim) + ".*$"); //*? means non-greedy match so find first
	var rgResults = patt.exec(title);

	if (rgResults == null || rgResults[1] === undefined)
		se.estimate = 0;
	else {
		se.estimate = parseFixedFloat(rgResults[1], true);
		if (!isNaN(se.estimate)) {
			title = title.replace(leftDelim + rgResults[1] + rightDelim, "").trim();
			se.titleNoSE = title;
			se.bParsed = true;
		}
	}

	leftDelim = "[";
	rightDelim = "]";
	patt = new RegExp("^.*" + makePatt(leftDelim, rightDelim) + ".*$"); //normal (greedy) match so it finds last
	rgResults = patt.exec(title);
	if (rgResults == null || rgResults[1] === undefined)
		se.spent = 0;
	else {
		se.spent = parseFixedFloat(rgResults[1], true);
		if (!isNaN(se.spent)) {
			se.titleNoSE = title.replace(leftDelim + rgResults[1] + rightDelim, "").trim();
			se.bParsed = true;
		}
	}
	return se;
}

/* detectMovedCards
 *
 * detect when the current user moves a card through trello UI.
 * when so, moves existing card history to the new board
 **/
function detectMovedCards() {
	setInterval(function () {
		if (!g_bReadGlobalConfig)
			return;
		var hooked="agile_moveHooked";
		var buttonFindMove = $(".js-submit");
		if (buttonFindMove.length == 0)
			return;

		var iTest = 0;
		var buttonMove = null;
		for (; iTest < buttonFindMove.length; iTest++) {
			var btnTest = buttonFindMove.eq(iTest);
			if (btnTest.hasClass(hooked))
				return;
			if (btnTest.val() != "Move")
				continue;
			var topParent = btnTest.parent().parent().parent();
			if (!topParent.hasClass("pop-over"))
				continue;
			var headerTitle = topParent.find(".header-title").eq(0);
			if (headerTitle.length != 1 || headerTitle.text() != "Move Card")
				continue;
			buttonMove = btnTest;
			break;
		}

		if (buttonMove == null)
			return;
		if (buttonMove.hasClass(hooked))
			return;
		var parent = buttonMove.parent().parent();
		var boardMoveElem = parent.find(".js-board-value").eq(0);
		if (boardMoveElem.length == 0)
			return;
		var idCardCur = getIdCardFromUrl(document.URL);
		if (idCardCur == 0)
			return;
		buttonMove.addClass(hooked);
		var spanIcon = $('<span></span>').css("margin-left", "4px");
		var icon = $("<img>").attr("src", chrome.extension.getURL("images/icon16.png")).css("margin-bottom", "-3px");
		//icon.addClass("agile-spent-icon-header");
		icon.attr("title", "Plus will move S/E data to new new board.");
		spanIcon.append(icon);
		spanIcon.insertAfter(buttonMove);

		var boardCur = getCurrentBoard();
		buttonMove.click(function () {
			var boardNameNew = boardMoveElem.text();
			if (boardNameNew == boardCur)
				return;
			if (isBackendMode()) {
				setTimeout(function () {
					alert("Plus for Trello: After pressing OK, Plus will take you to the moved card. You must report an S/E of 0/0 once there."); //review zig automate this.
					window.location.href = "https://trello.com/c/" + idCardCur;
				}, 300);
				return;
			} else {
				function handleIdNotFound(idCardCur) {
					alert("IMPORTANT: Plus for Trello could not find the new board (has not been used yet in Plus). To correct, please enter an S/E of 0/0 on the card after pressing OK.");
					window.location.href = "https://trello.com/c/" + idCardCur;
				}

				var userCur = getCurrentTrelloUser();
				if (userCur == null) {
					handleIdNotFound(idCardCur);
					return;
				}

				FindIdBoardFromBoardName(boardNameNew,  function (idBoardFound) {
					if (idBoardFound == null)
						handleIdNotFound(idCardCur);
					else
						doInsert00History(idCardCur, idBoardFound, boardNameNew, userCur, boardCur);
				});
			}
		});
	}, 400);
}

/* FindIdBoardFromBoardName
 * 
 * does callback(idBoard).
 * WARNING: can return null even on a valid board. Happens when board hasnt been accesed by the user through Plus.
 *
**/
function FindIdBoardFromBoardName(boardNameNew, callback) {
	//First try to get it from storage (more common)
	var key = getKeyForIdFromBoard(boardNameNew);
	chrome.storage.local.get(key, function (obj) {
		var value = obj[key];
		//If not in storage look for it on the db
		if (value === undefined) {
			var sql = "select idBoard FROM boards WHERE name=?";
			var values = [boardNameNew];
			getSQLReport(sql, values,
				function (response) {
					if (response.rows === undefined || response.rows.length != 1 || response.rows[0].idBoard === undefined) {
						callback(null);
					} else {
						callback(response.rows[0].idBoard);
					}
				});
		} else {
			callback(value.idBoard);
		}
	});
}

function doInsert00History(idCardCur, idBoardNew, boardNameNew, userCur, boardCur) {
	var sql = "select name FROM cards WHERE idCard=?";
	var values = [idCardCur];
	getSQLReport(sql, values,
		function (response) {
			if (response.rows && response.rows.length == 1 && response.rows[0].name) {
				var nameCard = response.rows[0].name;
				helperInsertHistoryRow(new Date(), idCardCur, idBoardNew, boardNameNew, nameCard, userCur, 0, 0, "Plus: card moved from '"+boardCur+"'");
				sendDesktopNotification("Plus has moved the card's data to the new board.", 8000);
			}
		});
}