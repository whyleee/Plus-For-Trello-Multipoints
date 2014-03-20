/*
 Plus for trello
 Based on Trello 3000 v.0.1.1
*/

var UPDATE_STEP = 1000; //review zig detect url change faster and force update in 200ms.
var ESTIMATION = 'estimation';
var SPENT = 'spent';
var REMAINING = 'remaining';
var spentTotal;
var estimationTotal;
var remainingTotal;
var g_boardName = null;

function getSpentSpecialUser() {
	//review zig: wrap g_configData futher as it can be null
	if (g_configData)
		return g_configData.spentSpecialUser;
	return "";
}

function processCardFullWindows() {
	if (!g_bReadGlobalConfig)
		return;

	var sidebars = $(".window-sidebar");
	if (sidebars.length == 0)
		return;

	if (isBackendMode()) {
		var siblings = sidebars.prev();
		var elems = siblings.find($(".phenom-desc"));
		var j = 0;
		for (j = 0; j < elems.length; j++) {
			var elem = elems.eq(j);
			var mentioned = elem.find($(".atMention:contains(" + "@" + getSpentSpecialUser() + ")"));
			if (mentioned.length > 0) {
				var sibling = $(elem).next();
				sibling.find($(".js-edit-action")).hide();
				sibling.find($(".js-confirm-delete-action")).hide();
			}
		}
	}
	var actions = sidebars.find($("h3:contains(" + "Actions" + ")"));
	var divInsert = actions.next();
	if (divInsert.find($("#agile_timer")).size() == 0) {
		var url = document.URL;
		var idCardCur = getIdCardFromUrl(url);
		if (idCardCur != 0)
			divInsert.prepend(loadCardTimer(idCardCur));
	}
}


function getIdCardFromUrl(url) { //review zig: fix to return null like getIdBoardFromUrl
	var strSearch = "https://trello.com/c/";
	if (url.indexOf(strSearch) != 0)
		return 0;

	var remainUrl = url.slice(strSearch.length);
	remainUrl = remainUrl.slice(0, remainUrl.indexOf("/"));
	return remainUrl;
}

function getIdBoardFromUrl(url) {
	var strSearch = "https://trello.com/b/";
	if (url.indexOf(strSearch) != 0)
		return null;

	var remainUrl = url.slice(strSearch.length);
	remainUrl = remainUrl.slice(0, remainUrl.indexOf("/"));
	return remainUrl;
}

var g_bErrorExtension = false;

function showExtensionError(e) {
	var strError = "Plus for Trello has been updated to a new version!\nplease refresh this page after pressing OK.";
	if (e && e.message && e.message.indexOf("Error connecting to extension") != 0)
		strError += ("\n\nDetailed error:\n" + e.message);
	alert(strError);
}

function testExtension(callback) {
	try {
		if (g_bErrorExtension) {
			showExtensionError();
			return;
		}
		//REVIEW zig: enable for all not just spent backend. null marker indicates to remove all logs
		var bDoWriteLog = isBackendMode();
		var rgLog=g_plusLogMessages;

		if (!bDoWriteLog)
			rgLog=[null];

		sendExtensionMessage({ method: "testBackgroundPage", logMessages: rgLog, bDoWriteLog: bDoWriteLog, tuser: getCurrentTrelloUser() }, //note: we reuse this test message to save 
		function (response) {
			if (response.status == "OK") { //status of log write
				if (bDoWriteLog)
					g_plusLogMessages = [];
			}
			if (callback)
				callback();
		}, true); //true to rethrow exceptions
	} catch (e) {
		g_bErrorExtension = true;
		showExtensionError(e);
	}
}

$(function () {
	loadOptions(function () {
		entryPoint();
	});

});

function entryPoint() {
	//note: this also does setInterval on the callback which we use to do sanity checks and housekeeping
	setCallbackPostLogMessage(testExtensionAndcommitPendingPlusMessages); //this allows all logs (logPlusError, logException) to be written to the database
	Help.init();
	HelpButton.display(); //inside is where the fun begins
	checkEnableMoses();
}

function loadOptions(callback) {
	var keyIgnoreZeroECards = "bIgnoreZeroECards";
	var keyAcceptSFT = "bAcceptSFT";
	var keyAlreadyDonated = "bUserSaysDonated";
	//get options from sync. If not there, might be in local (older version), so upgrade it.
	//review zig: remove local check by aug.c2014
	chrome.storage.sync.get([keyAcceptSFT, keyIgnoreZeroECards, keyAlreadyDonated], function (objSync) {
		g_bUserDonated = objSync[keyAlreadyDonated] || false;
		if (objSync[keyAcceptSFT] === undefined || objSync[keyIgnoreZeroECards] === undefined) {
			chrome.storage.local.get([keyAcceptSFT, keyIgnoreZeroECards], function (objLocal) {
				g_bAcceptSFT = objLocal[keyAcceptSFT] || false;
				g_bIgnoreZeroECards = objLocal[keyIgnoreZeroECards] || false;
				var objNew={};
				objNew[keyAcceptSFT]=g_bAcceptSFT;
				objNew[keyIgnoreZeroECards]=g_bIgnoreZeroECards;
				chrome.storage.sync.set(objNew, function () {
					if (chrome.runtime.lastError === undefined) {
						chrome.storage.local.remove([keyAcceptSFT, keyIgnoreZeroECards]);
					}
					callback();
				});
			});
		} else {
			g_bAcceptSFT = objSync[keyAcceptSFT] || false;
			g_bIgnoreZeroECards = objSync[keyIgnoreZeroECards] || false;
			callback();
		}
	});
}

function doAllUpdates() {
	markForUpdate();
	processCardFullWindows();
	addCardCommentHelp();
}


var g_globalTotalSpent = null; //used to detect changes on global spent
var g_globalTotalEstimation = null; //used to detect changes on global est
var g_strPageHtmlLast = "";
var g_bNeedsUpdate = true;


/* markForUpdate
 *
 * Waits until changes stabilize to make an update
 **/
function markForUpdate() {
	var strPageHtml = document.body.innerHTML;
	if (!g_bForceUpdate && g_strPageHtmlLast != "" && strPageHtml != g_strPageHtmlLast) {
		g_bNeedsUpdate = true;
		g_strPageHtmlLast = strPageHtml;
	} else if (g_bNeedsUpdate || g_bForceUpdate) {
		g_strPageHtmlLast = strPageHtml;
		update();
	}
}


var g_bForceUpdate = false;

function update() {
	updateWorker();
}

function updateNewTrelloFlag() {
	//review zig: getCurrentBoard also updates. unify. not sure if this always gets called before getCurrentBoard. since old will go away is not worth it.
	var elemLogoNew = $(".js-home-via-logo");
	//g_bNewTrello = (elemLogoNew.length > 0);
	g_bNewTrello = true;
}

function updateWorker() {
	updateNewTrelloFlag();
	HelpButton.display();
	CalcOptions.display();
	InfoBoxManager.update();
	if (!g_bForceUpdate && isTimerRunningOnScreen())
		return;
	var boardCur = getCurrentBoard();
	var bOnBoardPageWithoutcard = (getIdBoardFromUrl(document.URL) != null);
	//note: when a card is up we want to avoid reparsing the board, user is typing etc
	if (boardCur != null && (g_bForceUpdate || bOnBoardPageWithoutcard))
		updateCards(boardCur);
	g_bNeedsUpdate = false;
	g_bForceUpdate = false;
}

var g_strLastBoardNameIdSaved = null;

function updateCards(boardCur) {
	var globalTotalSpent = 0;
	var globalTotalEstimation = 0;
	var idBoard = getIdBoardFromUrl(document.URL);

	if (idBoard != null && g_strLastBoardNameIdSaved != boardCur) {
		doSaveBoardValues({ idBoard: idBoard }, getKeyForIdFromBoard(boardCur));
		detectRenamedBoard(idBoard, boardCur);
		g_strLastBoardNameIdSaved = boardCur;
	}

	List.all().each(function (i, el) {
		var h2 = null;
		if (g_bNewTrello)
			h2 = $(el);
		else
			h2 = $(el).children('h2');

		//
		// Estimation box
		//
		var estimationBox = null;
		var h2SiblingsEstimationBox = h2.siblings('div.agile_estimation_box');
		if (h2SiblingsEstimationBox.size() < 1) {
			estimationBox = InfoBoxFactory.makeInfoBox(ESTIMATION);
			h2.after(estimationBox);
		} else {
			estimationBox = h2SiblingsEstimationBox.eq(0);
		}

		//
		// Spent box
		//	
		var spentBox = null;
		var h2SiblinsSpentBox = h2.siblings('div.agile_spent_box');
		if (h2SiblinsSpentBox.size() == 0) {
			spentBox = InfoBoxFactory.makeInfoBox(SPENT);
			h2.after(spentBox);
			var brTag = $("<br /> ");
			h2.after(brTag);
		} else {
			spentBox = h2SiblinsSpentBox.eq(0);
		}

		var cards = List.cards(el);
		var totalEstimation = 0;
		var totalSpent = 0;
		cards.each(function (k, card) {
			var originalTitleTag = Card.titleTag(card);
			var updateTotals = CalcOptions.ignoreFilters || $(card).is(":visible");

			LabelsManager.update($(card));

			//
			// Get the estimated scrum units
			//
			var tmpTitleTag = originalTitleTag.clone();
			tmpTitleTag.children('span').remove();
			var title = tmpTitleTag.text();
			var se = parseSE(title);
			var estimation = se.estimate;
			totalEstimation += updateTotals ? estimation : 0;

			//
			// Get the spent scrum units
			//
			var spent = se.spent;
			totalSpent += updateTotals ? spent : 0;

			//
			// Get the card hashtag list
			//
			var hashtags = Card.hashtagsFromTitle(title);

			//
			// Show a title w/o the markup
			//
			var cleanTitle = se.titleNoSE;
			var bRecurring = (cleanTitle.indexOf(TAG_RECURRING_CARD) >= 0);
			var idCardCur = getIdCardFromUrl(originalTitleTag[0].href);

			if (bRecurring)
				cleanTitle = cleanTitle.replace(/\[R\]/g, "");

			var cloneTitleTag = null;
			var originalTitleSiblings = originalTitleTag.siblings('a.agile_clone_title');
			if (originalTitleSiblings.size() == 0) {
				cloneTitleTag = originalTitleTag.clone();
				originalTitleTag.addClass('agile_hidden');
				cloneTitleTag.addClass('agile_clone_title');
				originalTitleTag.after(cloneTitleTag);
				if (bRecurring) {
					var imgRecurring = $("<img>").attr("src", chrome.extension.getURL("images/recurring.png"));
					imgRecurring.attr("title", TAG_RECURRING_CARD);
					var spanRecurring = $("<span>");
					spanRecurring.append(imgRecurring);
					cloneTitleTag.append(spanRecurring);
				}
			} else {
				cloneTitleTag = originalTitleSiblings.eq(0);
			}

			if (idCardCur != 0) {
				checkAddTimerIcon(idCardCur, cloneTitleTag);
			}
			var ctlUpdate = cloneTitleTag.contents()[1];
			//if (bRecurring)
			//	ctlUpdate=ctlUpdate.prev();
			if (ctlUpdate !== undefined)
				ctlUpdate.textContent = cleanTitle;
			else {
				var test = 1; //for breakpoint
			}
			//
			// Badges
			//
			var badges = $(card).children('div.list-card-details').eq(0).children('div.badges');
			var bNoBadges = (spent == 0 && estimation == 0);

			// Estimate
			var estimateBadge = badges.children('div.' + BadgeFactory.estimateBadgeClass());
			if (estimateBadge.size() == 0) {
				if (!bNoBadges) {
					estimateBadge = BadgeFactory.makeEstimateBadge();
					badges.prepend(estimateBadge);
				}
			}
			else {
				if (bNoBadges)
					estimateBadge.remove();
			}
			if (!bNoBadges)
				estimateBadge.contents().last()[0].textContent = estimation;

			// Spent
			var spentBadge = badges.children('div.' + BadgeFactory.spentBadgeClass());

			if (spentBadge.size() == 0) {
				if (!bNoBadges) {
					spentBadge = BadgeFactory.makeSpentBadge();
					badges.prepend(spentBadge);
				}
			}
			else {
				if (bNoBadges)
					spentBadge.remove();
			}
			if (!bNoBadges)
				spentBadge.contents().last()[0].textContent = spent;

			// Hashtags
			var hashtagsJq = badges.children('.agile_hashtags');
			if (hashtagsJq.length == 0) {
				hashtagsJq = $('<span />').addClass('agile_hashtags');
				badges.append(hashtagsJq);
			}
			hashtagsJq.html('');
			for (var i = 0; i < hashtags.length; i++) {
						hashtagsJq.append($('<span />')
								.addClass(i==0?'badge agile_badge agile_badge_hashtag_primary':'badge agile_badge agile_badge_hashtag_secondary')
								.html(hashtags[i]));
			}
			//if (!bRecurring && spent!=0 && Math.abs(spent-estimation)<0.01)
			//	$(card).hide();
			//else
			//	$(card).show();
		});
		totalEstimation = parseFixedFloat(totalEstimation);
		totalSpent = parseFixedFloat(totalSpent);
		estimationBox.html(Card.estimationLabelText(totalEstimation));
		spentBox.html(Card.spentLabelText(totalSpent));
		globalTotalEstimation += totalEstimation;
		globalTotalSpent += totalSpent;
	});
	globalTotalEstimation = parseFixedFloat(globalTotalEstimation);
	globalTotalSpent = parseFixedFloat(globalTotalSpent);
	estimationTotal.html(Card.estimationLabelText(globalTotalEstimation));
	spentTotal.html(Card.spentLabelText(globalTotalSpent));
	var difference = parseFixedFloat(globalTotalEstimation - globalTotalSpent);

	remainingTotal.html(Card.remainingLabelText(difference));
	var bSetTimeout = false;
	if (g_globalTotalSpent != null && (g_globalTotalSpent != globalTotalSpent || g_globalTotalEstimation != globalTotalEstimation)) {
		bSetTimeout = true;
	}
	g_globalTotalSpent = globalTotalSpent;
	g_globalTotalEstimation = globalTotalEstimation;
	updateBoardSEStorage(boardCur, g_globalTotalSpent, g_globalTotalEstimation);
	if (bSetTimeout)
		setTimeout(function () { updateSsLinksDetector(globalTotalSpent, globalTotalEstimation); }, 500); //let it breathe.
	CopyToClipboardButton.update();
}

function checkAddTimerIcon(idCard, cloneTitleTag) {

	var hash = getCardTimerSyncHash(idCard);
	getCardTimerData(hash, function (obj) {
		hash = obj.hash;
		var stored = obj.stored;
		var imgTimer = cloneTitleTag.find('.agile_timer_icon_small');
		if (stored !== undefined && stored.msEnd == null) {
			if (imgTimer.length == 0) {
				imgTimer = $("<img>").attr("src", chrome.extension.getURL("images/icon16.png")).addClass('agile_timer_icon_small');
				imgTimer.attr("title", "Active timer");
				var span = $("<span>");
				span.append(imgTimer);
				cloneTitleTag.append(span);
			}
		} else if (imgTimer.length > 0)
			imgTimer.remove();
	});
}

function updateSsLinksDetector(globalTotalSpent, globalTotalEstimation) {
	var user = getCurrentTrelloUser();

	if (user != null && globalTotalSpent == g_globalTotalSpent && globalTotalEstimation == g_globalTotalEstimation)
		updateSsLinks();
	else {
		var gTSLocal = g_globalTotalSpent;
		var gTELocal = g_globalTotalEstimation;
		setTimeout(function () { updateSsLinksDetector(gTSLocal, gTELocal); }, 500); //try later until it stabilizes
	}
}

function stringStartsWith(string, input) {
	return string.substring(0, input.length) === input;
}


var List = {
	all: function () {
		if (g_bNewTrello)
			return $('.list-header-name');
		return $('div.list-title');
	},
	cards: function (list) {
		var cardsContainer = $(list).parent();
		if (!g_bNewTrello)
			cardsContainer = cardsContainer.siblings('div.list-card-area').children('div.list-cards').eq(0);
		else
			cardsContainer = cardsContainer.siblings('div.list-cards').eq(0);
		var cards = $(cardsContainer).children('div.list-card');
		return cards;
	}
};

var InfoBoxManager = {
	//
	// TODO: Fix this weirdness. The elements are created from outside, 
	// but used inside here. Weird dependency.
	//
	update: function () {
		var boardHeader = null;

		if (g_bNewTrello)
			boardHeader = $('div.board-header');
		else
			boardHeader = $('div#board-header');


		if (boardHeader.length == 0)
			return;
		boardHeader.append(estimationTotal);
		boardHeader.append(spentTotal);
		boardHeader.append(remainingTotal);
		burndownLink = $(".agile_plus_burndown_link");
		if (burndownLink.length != 0)
			boardHeader.append(burndownLink);
	}
};

var InfoBoxFactory = {
	makeInfoBox: function (type) {
		var box = $('<div></div>').addClass('agile_box');
		if (type == ESTIMATION) {
			return box.addClass('agile_estimation_box').html('E: 0');
		} else if (type == SPENT) {
			return box.addClass('agile_spent_box').html('S: 0');
		}
	},
	makeTotalInfoBox: function (type) {
		var box = $('<div></div>').addClass('agile_box').addClass('agile_total_box');
		if (type == ESTIMATION) {
			return box.addClass('agile_estimation_box').html('E: 0');
		} else if (type == SPENT) {
			return box.addClass('agile_spent_box').html('S: 0');
		} else if (type == REMAINING) {
			return box.addClass('agile_remaining_box').html('R: 0');
		}
	}
};

var BadgeFactory = {
	baseBadge: function () {
		return $('<div></div>').addClass('badge');
	},
	makeEstimateBadge: function () {
		var b = this.baseBadge().addClass('agile_badge').addClass(this.estimateBadgeClass());
		b.append('0');
		return b;
	},
	makeSpentBadge: function () {
		var b = this.baseBadge().addClass('agile_badge').addClass(this.spentBadgeClass());
		b.append('0');
		return b;
	},
	makeRemainingBadge: function () {
		var b = this.baseBadge().addClass('agile_badge').addClass(this.remainingBadgeClass());
		b.append('0');
		return b;
	},
	estimateBadgeClass: function () {
		return "agile_badge_estimate";
	},
	spentBadgeClass: function () {
		return "agile_badge_spent";
	},
	remainingBadgeClass: function () {
		return "agile_badge_remaining";
	}
};


var ColorFactory = {
	colors: {},
	generateColor: function (text) {
		return "blue";
	},
	newColor: function () {
		var values = [0, 75, 125, 175];
		var parts = [this.randomHex(values), this.randomHex(values), this.randomHex(values)];
		return "#" + parts.join('');
	},
	randomHex: function (values) {
		var index = Math.floor(Math.random() * values.length);
		var hex = Math.floor(values[index]).toString(16);
		return (hex.length == 1) ? '0' + hex : hex;
	}
};
