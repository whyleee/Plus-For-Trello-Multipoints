var CopyToClipboardButton = {
	create: function (text) {
		var b = $("<a href=\"#\">" + Language.copy_to_clipboard + "</a>").addClass('button-link agile_close_button');
		b.click(function () {
			window.prompt("Card ID", text);
		});
		return b;
	},
	update: function () {
		var windowOverlay = $('div.window-overlay div.window-sidebar');
		var cardId = windowOverlay.find('p.quiet.bottom span span').html();
		var copyButtonContainer = windowOverlay.find('div.window-module.other-actions div:first');
		var copyButton = copyButtonContainer.children('a.agile_close_button');
		if (copyButton.size() == 0) {
			copyButton = CopyToClipboardButton.create(cardId);
			copyButtonContainer.append(copyButton);
		} else {
			copyButton = copyButton.eq(0);
		}
	}
};


var HelpButton = {
	class: 'agile_help_button',
	create: function () {
		var b = $('<span id="help_buttons_container"></span>').addClass('header-btn header-notifications ' + this.class);


		var spanIcon = $('<span></span>').css('cursor', 'help');
		var icon = $("<img>").attr("src", chrome.extension.getURL("images/iconspent.png"));
		icon.addClass("agile-spent-icon-header");
		icon.attr("title", "Plus Help");
		spanIcon.append(icon);

		b.append(spanIcon);
		icon.click(function () {
			Help.display();
		});

		configureSsLinks(b);
		return b;
	},
	display: function () {
		var header = $('div#header div.header-user');
		if (header.find('.' + this.class).size() == 0) {
			var objThis = this.create();
			header.prepend(objThis);
		}
	}
};


var CalcOptions = {
	class: 'agile_ignore_filters_option',
	ignoreFilters: true,
	display: function () {
	},
	checkboxOnClick: function () {
		CalcOptions.ignoreFilters = $(this).is(':checked');
	}
};

var g_intervalCheckPlusFeed = null;
function insertPlusFeed(bForce) {
	if (g_intervalCheckPlusFeed != null && !bForce)
		return;

	var stateFeed = {
		msLastPostRetrieved: 0,		// date of most recent post retrieved
		msLastPostReadByUser: 0,	// date of last post read by user
		msLastQuery: 0,				// date we last made a query. shouldnt do more than once every 3 hours to prevent sync issues and api overuse.
		msUserClicked: 0
	};

	var icon = $(".agile-icon-new-header");

	if (icon.length > 0)
		return;

	function doGetFeed() {
		var key = "gplusfeeddata";
		chrome.storage.sync.get(key, function (obj) {
			var data = obj[key];
			if (data !== undefined)
				stateFeed = data;
			var msNow = (new Date()).getTime();
			if (msNow - stateFeed.msLastQuery > 1000 * 60 * 60 * 2) { //2 hours
				setTimeout(function () { //delay a few seconds because usually happens on trello page load, wait until that settles
					sendExtensionMessage({ method: "getPlusFeed", msLastPostRetrieved: stateFeed.msLastPostReadByUser },
					function (response) {
						stateFeed.msLastPostRetrieved = response.msLastPostRetrieved;
						stateFeed.msLastQuery = msNow;
						var objSave = {};
						objSave[key] = stateFeed;
						if (true) {
							chrome.storage.sync.set(objSave, function () {
								if (chrome.runtime.lastError === undefined)
									insertPlusFeedWorker(stateFeed, key);
							});
						}
					});
				}, 3000);
			} else {
				insertPlusFeedWorker(stateFeed, key);
			}
		});
	}

	setTimeout(function () { doGetFeed(); }, 1000); //use timeout so icon doesnt jump left after inserted (let plus header breather)
	
	if (g_intervalCheckPlusFeed != null)
		return;
	//since feed is only updated if the tab is active etc, we check often if it needs updating.
	g_intervalCheckPlusFeed=setInterval(function () {
		if (document.webkitHidden)
			return;
		doGetFeed();
	}, 1000 * 60 * 5); //every 5 minutes
}

function insertPlusFeedWorker(stateFeed, key) {
	var icon = $(".agile-icon-new-header");
	var spanIcon = null;
	var bShowNewIcon= false;
	var bShowRecentIcon = false;
	var pathImgRecent = "images/newgray.png";
	var strTipRecent = "Recently viewed Plus features";

	if (stateFeed.msLastPostReadByUser < stateFeed.msLastPostRetrieved)
		bShowNewIcon = true;
	else {
		var now = (new Date()).getTime();
		if (stateFeed.msUserClicked > 0 && now - stateFeed.msUserClicked < 1000 * 60 * 60) //show read icon for 1 hour since last clicked
			bShowRecentIcon = true;
	}
	if (bShowNewIcon || bShowRecentIcon) {
		if (icon.length == 0) {
			var parent = $("#help_buttons_container");
			spanIcon = $('<span></span>').css('cursor', 'pointer');
			spanIcon.hide();
			icon = $("<img>");
			icon.addClass("agile-icon-new-header");
			spanIcon.append(icon);
			parent.prepend(spanIcon);
			icon.click(function () {
				chrome.storage.sync.get(key, function (obj) {
					var stateOrig = cloneObject(stateFeed);
					var data = obj[key];
					if (data !== undefined)
						stateFeed.msLastPostRetrieved = Math.max(data.msLastPostRetrieved, stateOrig.msLastPostRetrieved);
					stateFeed.msLastPostReadByUser = stateFeed.msLastPostRetrieved;
					stateFeed.msUserClicked = (new Date()).getTime();
					if (stateOrig.msLastPostRetrieved != stateFeed.msLastPostRetrieved
						|| stateOrig.msLastPostReadByUser != stateFeed.msLastPostReadByUser
						|| (stateFeed.msUserClicked - stateOrig.msUserClicked > 1000 * 60 * 5)) { //protect sync quota for 5min if only msUserClicked changed
						var objSave = {};
						objSave[key] = stateFeed;
						chrome.storage.sync.set(objSave, function () { });
					}
				});
				icon.attr("src", chrome.extension.getURL(pathImgRecent));
				icon.attr("title", strTipRecent);
				window.open('https://plus.google.com/109669748550259696558/posts', '_blank');
			});
		} else {
			spanIcon = icon.parent();
		}
		icon.attr("src", chrome.extension.getURL(bShowNewIcon ? "images/new.png" : pathImgRecent));
		icon.attr("title", bShowNewIcon?"New Plus features!": strTipRecent);
		spanIcon.fadeIn(600);
	} else {
		if (icon.length > 0) {
			spanIcon = icon.parent();
			spanIcon.hide();
		}
	}
}