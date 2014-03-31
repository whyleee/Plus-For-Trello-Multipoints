var Help = {
	m_container: null,
	m_manifestVersion: "",

	init: function () {
		if (Help.m_manifestVersion != "")
			return;
		var url = chrome.extension.getURL("manifest.json");
		var xhr = new XMLHttpRequest();
		xhr.onreadystatechange = function (e) {
			if (xhr.readyState == 4 && xhr.status == 200) {
				var manifest = JSON.parse(xhr.responseText);
				Help.m_manifestVersion = manifest.version;
			}
		};

		xhr.open("GET", url);
		xhr.send();
	},

	para: function (h, container) {
		var p = $('<p></p>').html(h);
		if (container === undefined)
			container = this.m_container;
		container.append(p);
		return p;
	},
	storageTotalSync: 0,
	storageTotalLocal: 0,
	storageTotalLocalStorage: 0,
	totalDbRowsHistory: 0,
	totalDbRowsHistoryNotSync: 0,
	totalDbMessages: 0,
	bDontShowAgainSyncWarn: false,
	bAcceptSFT: false,
	display: function () {
		if ($('div#agile_help_container').size() > 0 || this.m_container != null) {
			return;
		}
		var thisObj = this;
		testExtension(function () { //show help only if connected, plus this also commits pending log messages
			chrome.storage.sync.getBytesInUse(null,
				function (bytesInUse) {
					thisObj.storageTotalSync = bytesInUse;
					chrome.storage.local.getBytesInUse(null,
						function (bytesInUse2) {
							thisObj.storageTotalLocal = bytesInUse2;
							sendExtensionMessage({ method: "getlocalStorageSize" },
								function (response) {
									thisObj.storageTotalLocalStorage = response.result;
									if (g_dbOpened) {
										sendExtensionMessage({ method: "getTotalDBRows" },
											function (response) {
												if (response.status != "OK")
													thisObj.totalDbRowsHistory = response.status;
												else
													thisObj.totalDbRowsHistory = response.cRowsTotal;

												sendExtensionMessage({ method: "getTotalDBRowsNotSync" },
													function (response) {
														if (response.status != "OK")
															thisObj.totalDbRowsHistoryNotSync = response.status;
														else
															thisObj.totalDbRowsHistoryNotSync = response.cRowsTotal;

														var keySyncWarn = "bDontShowAgainSyncWarn";
														chrome.storage.local.get([keySyncWarn], function (obj) {
															var value = obj[keySyncWarn];
															if (value !== undefined)
																thisObj.bDontShowAgainSyncWarn = value;

															thisObj.bAcceptSFT = g_bAcceptSFT;

															sendExtensionMessage({ method: "getTotalDBMessages" },
																 function (response) {
															 		if (response.status != "OK")
															 			thisObj.totalDbMessages = response.status;
															 		else
															 			thisObj.totalDbMessages = response.cRowsTotal;

															 		thisObj.displayWorker();
																 });
														});

													});
											});
									} else {
										thisObj.totalDbMessages = 0;
										thisObj.totalDbRowsHistory = 0;
										thisObj.totalDbRowsHistoryNotSync = 0;
										thisObj.displayWorker();
									}
								});
						}
					);
				}
			);
			});
	},


	displayWorker: function () {
		var helpWin = this;
		var bNotSetUp = (g_configData == null);
		var container = $('<div id="agile_help_container" tabindex="0"></div>').height($(window).height());
		helpWin.m_container = container;
		var elemClose = helpWin.para('<span class="agile_help_close">(close help)</span>');
		elemClose.click(function () {
			Help.close();
		});
		helpWin.para('<h1>Plus for Trello Help</h1>');
		if (g_bFirstTimeUse)
			helpWin.para('To show this help window anytime, click the hourglass icon on the Trello header.');
		helpWin.para('version: ' + Help.m_manifestVersion + ' &nbsp&nbsp<A target="_blank" href="https://chrome.google.com/webstore/detail/plus-for-trello/gjjpophepkbhejnglcmkdnncmaanojkf/reviews" title="Give Plus 5 stars!\nHelp make Plus more popular so I can keep improving it.">Rate </A> &nbsp&nbsp \
			<A target="_blank" href="https://chrome.google.com/webstore/support/gjjpophepkbhejnglcmkdnncmaanojkf">Send Feedback</a> &nbsp&nbsp\
			<A target="_blank" href="https://chrome.google.com/webstore/detail/plus-for-trello/gjjpophepkbhejnglcmkdnncmaanojkf/details">View Change Log</a> &nbsp&nbsp\
			<a href="https://plus.google.com/109669748550259696558/posts" \
   rel="publisher" target="_blank"> \
<img src="https://ssl.gstatic.com/images/icons/gplus-16.png" alt="Plus for Trello Google+ page" style="border:0;width:16px;height:16px;"/>&nbsp;Follow</a>');
		if (helpWin.totalDbMessages > 0) {
			helpWin.para('Alert: Error log has entries. Scroll to the bottom.').css("color", "red");
		}

		if (bNotSetUp && helpWin.totalDbRowsHistory > 0) {
			helpWin.para('<h2><b>WARNING:</b></h2>').css("color", "red");
			helpWin.para('You have not set-up Google sync! Historical S/E data is stored only on this machine and cannot see other team/devices data.');
			helpWin.para('Thus you can lose your historical data if your hard drive fails, reinstall Chrome etc.');
			helpWin.para('Once you set-up Google sync (scroll below), all your historical data from all your chrome devices will be merged in the Google cloud.');
			var checkDontShowAgainSyncWarn = helpWin.para('<input style="vertical-align:middle;" type="checkbox" class="agile_checkHelp" value="checkedDontSW">TLDR. I dont care if I lose my data, dont show this warning on startup.</input>').children('input:checkbox:first');
			if (helpWin.bDontShowAgainSyncWarn)
				checkDontShowAgainSyncWarn[0].checked = true;

			checkDontShowAgainSyncWarn.click(function () {
				var bValue = checkDontShowAgainSyncWarn.is(':checked');
				var pair = {};
				pair["bDontShowAgainSyncWarn"] = bValue;
				chrome.storage.local.set(pair, function () { });
			});
			helpWin.para('&nbsp');
		} else {
			if (helpWin.totalDbRowsHistoryNotSync > 0) {
				var strPre = "" + helpWin.totalDbRowsHistoryNotSync + ' history rows pending sync. ';
				if (helpWin.totalDbRowsHistoryNotSync > 9) { //simple sync test. could happen also if user entered a lot of s/e reports within 5 minutes.
					helpWin.para(strPre+'Check again in 10 minutes while Trello is open.').css("color", "red");
					helpWin.para('If still not synced, make sure spreadsheet sharing is setup correctly with Write access to you.').css("color", "red");
				} else {
					helpWin.para(strPre+'Will sync within the next 10 minutes.');
				}
				helpWin.para('Note: Rows may already be in the sync spreadsheet but Plus considers them pending until it verifies them in the next sync.');
				helpWin.para('&nbsp');
			}
		}

		var divDonations = $('<div></div>').hide();
		this.m_container.append(divDonations);

		helpWin.para('I am committed to keeping this extension free, but I need your help!', divDonations);
		helpWin.para('You can help by donating, contributing your skills for better manuals, graphic design or coding.', divDonations);
		helpWin.para('Your donation allows me to maintain and keep improving Plus. I have a lot of pending features to implement!', divDonations);
		helpWin.para('Donations so far from all users: $198.00 total. The Plus Team has spent over 700 hours so far to develop this software.', divDonations);
		helpWin.para('<b>Donate securely through Paypal, which doesnt send me your credit card.</b>', divDonations);
		helpWin.para('<form action="https://www.paypal.com/cgi-bin/webscr" method="post" target="_top">\
<input type="hidden" name="cmd" value="_s-xclick">\
<input type="hidden" name="encrypted" value="-----BEGIN PKCS7-----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-----END PKCS7-----">\
<input type="image" style="margin-bottom:0px" src="https://www.paypalobjects.com/en_US/i/btn/btn_donateCC_LG.gif" border="0" name="submit" title="YOUR donation counts a lot!">\
<img alt="" border="0" src="https://www.paypalobjects.com/en_US/i/scr/pixel.gif" width="1" height="1">\
</form>', divDonations);

		var checkDonated = helpWin.para('<input style="vertical-align:middle;" type="checkbox" class="agile_checkHelp" value="checkedDonated" \
					>I already donated, thanks!</input>').children('input:checkbox:first');
		if (g_bUserDonated) {
			checkDonated[0].checked = true;
			divDonations.hide();
		} else {
			divDonations.show();
		}
		checkDonated.click(function () {
			var bValue = checkDonated.is(':checked');
			var pair = {};
			pair["bUserSaysDonated"] = bValue;
			if (bValue)
				divDonations.slideUp();
			else
				divDonations.slideDown();
			chrome.storage.sync.set(pair, function () { g_bUserDonated = bValue; });
		});

		helpWin.para("<h2>Contents</h2><ul id='tocAgileHelp'></ul>");
		helpWin.para('&nbsp');
		helpWin.para('<b><h2 id="agile_help_scrumNote">Scrum for Trello users</h2></b>');
		helpWin.para('Enable the Scrum for Trello format below in Preferences. All team members <b>must</b> use the same setting.');
		helpWin.para('Pending (active) cards need their Spent/Estimates back-entered so they can be properly accounted in reports.');
		helpWin.para('See the "How to spend old estimates?" section below.');
		helpWin.para('&nbsp');

		helpWin.para('<b><h2 id="agile_help_gsync">Google sync</h2></b>');
		helpWin.para('Read <A target="_blank" href="http://spentfortrello.blogspot.com/2014/01/plus-configuration-options.html">here</A> about the different setup options.');

		sendExtensionMessage({ method: "checkLoggedIntoChrome" },
			function (response) {
				var bSpentBackendCase = false;
				if (!g_bReadGlobalConfig)
					helpWin.para('You must log into Trello to set up sync.'); //review zig: verify this code
				else {
					if (isBackendMode())
						bSpentBackendCase = true;
					setupPlusConfigLink(container, bNotSetUp);
				}
				helpWin.para('&nbsp');

				helpWin.para('<b><h2 id="agile_help_basichelp">Basic Help</h2></b>');
				helpWin.para('<img src="' + chrome.extension.getURL("images/s2.png") + '"/>');
				helpWin.para('S = Spent units');
				helpWin.para('E = Estimated units');
				helpWin.para('R = Remaining units');
				helpWin.para('&nbsp');
				helpWin.para('<img src="' + chrome.extension.getURL("images/s3.png") + '"/>');
				helpWin.para("&diams; The <A target='_blank' href='http://en.wikipedia.org/wiki/ISO_week_date'>ISO week</A>, as in 2014-W01, represents 2014's Week 1, always starting on sunday.");
				helpWin.para('&diams; The top bar shows your weekly report. Click the week to change it.');
				helpWin.para("&diams; Trello.com (boards home) shows your recently reported cards, your cards with pending balance and your team's weekly spent chart.");
				helpWin.para("&diams; Each board has a Dashboard link on top to see your team's complete S/E board burndown, markers and more.");
				helpWin.para("&diams; Chart and report pages can be bookmarked or emailed between team members.");
				helpWin.para("&diams; Click a chart box to see its tooltip and drill-down. the clipboard icon on its top-right copies the table to your clipboard. Paste it anywhere like a spreadsheet or email.");
				helpWin.para("&diams; Drill-down has full keyboard/touch support.");
				helpWin.para('&diams; New Plus features are written weekly.');
				helpWin.para('&nbsp');

				helpWin.para('<b><h2 id="agile_help_reportingSE">Reporting Spent/Estimate</h2></b>');
				helpWin.para('Estimate represent how many units (hours, days, etc.) will be needed to finish a card.');
				helpWin.para('Do NOT edit the (Spent/Estimate) in card titles yourself, the sysem does so automatically.');
				helpWin.para('&nbsp');
				helpWin.para('<img src="' + chrome.extension.getURL("images/s1.png") + '"/>');

				helpWin.para('All S/E reporting should be done from the S/E bar highlighted in yellow here.');
				helpWin.para('<b>S/E reporting is additive. This is the most important concept to understand Plus.</b> Here starting at the bottom (oldest comment):');
				helpWin.para('&diams; the card was initially estimated at 90 so its balance was (0/90)');
				helpWin.para('&diams; then it spent 3 calling Bolivia, balance (3/90)');
				helpWin.para('&diams; later 12 was spent in Russia, balance (15/90)');
				helpWin.para('&diams; finally 16 was added to the estimate, leaving it at (15/106) as can be seen on the final card title.');
				helpWin.para('&diams; this means that the card still has 91 units remaining');
				helpWin.para('&diams; <b>When you are done with a card and there is still a Remaining</b>, make sure to reduce its Estimate to match Spent so Plus knows its done.');
				helpWin.para('&nbsp');
				helpWin.para('<b><h2 id="agile_help_rules">Rules</h2></b>');
				helpWin.para('&diams; Comments after the S/E part are optional.');
				helpWin.para('&diams; If you only care about Spent and dont care about Estimates, check below in Preferences to "ignore missing estimates."');
				helpWin.para('&diams; S/E balances are unnafected by the column where you place a card.');
				helpWin.para('&diams; In the S/E boxes you can also type using the Hours:Minutes format, for example 1:20 means 1 hour 20 minutes which converts to 1.33 hours in the comment.');
				helpWin.para('&diams; Do NOT edit or delete a card comment you already reported to Plus, it wont be reflected in reports or balances.');
				helpWin.para('&diams; <b>If you made a mistake on a S/E report, enter a new S/E report to patch the previous one by using negative S/E.</b>');
				helpWin.para('&nbsp;&nbsp;&nbsp;For example, if you accidentally reported S:3, E:0 but it was meant for another card, simply report S: -3, E:0 on the error card.');
				helpWin.para("&diams; You may report back in time up to 10 days ago by clicking on 'now' and picking how many days ago the S/E happened.");
				helpWin.para('&nbsp;&nbsp;&nbsp;Reporting back in time is meant to be used only if you forgot to report it or need to correct it.');
				helpWin.para('&diams; For recurring cards where the Estimate constantly increases (like regular meetings) append ' + TAG_RECURRING_CARD + ' to the card name. this is used for some of the reports.');
				helpWin.para("&diams; If you begin a S/E comment with '!', it will show as a point annotation on the board's burndown. Good for showing milestones.");
				helpWin.para('&diams; You can place #hashtags on your card titles. This shows them as tags in the board view and you can filter by them in Reports by #typing them in the Card.');
				helpWin.para('&diams; Keyboard use: From the "S" box on a Card, use TAB to move to the next field. Once you reach the "Enter" button, the ENTER key works as well.');
				helpWin.para('&diams; Board S/E on the front page shows the S/E of the last time you entered the board and go away if you dont enter the board after a few days.');
				helpWin.para('&diams; Your Google permissions (oauth2) are used to create and read/write the sync spreadsheet. Your username, email or password is never used or stored.');
				helpWin.para('&nbsp');

				helpWin.para('<b><h2 id="agile_help_teammode">Team mode</h2></b>');
				helpWin.para('<A target="_blank" href="http://spentfortrello.blogspot.com/2014/01/plus-configuration-options.html">Read here</A> to learn about team mode.');
				helpWin.para('For team members in different timezones, each user reports on its own local time.');
				helpWin.para('Local time is used so everyone has the same consistent reports, for example to determine on which day or week a S/E belongs to.');
				helpWin.para('');
				helpWin.para('&nbsp');

				helpWin.para('<b><h2 id="agile_help_timers">Card Timers</h2></b>');
				helpWin.para("&diams; Stopping a timer will pre-fill its Spent on the Plus bar.");
				helpWin.para('&diams; After stopping a timer you can press the ENTER key or button to enter the S/E right away, or add an Estimate or Comment.');
				helpWin.para('&diams; If you already had values typed in the S/E boxes while the timer was running, stopping the timer will add to those existing values.');
				helpWin.para('&nbsp;&nbsp;&nbsp;Thus, if you stop a timer but dont press ENTER you can start the timer again, effectively continuing a paused timer.');
				helpWin.para('&nbsp;&nbsp;&nbsp;Another use is when you forget to start the timer. Type an aproximate Spent so far and the timer will add to it.');
				helpWin.para('&diams; Cards with active timers will have a hourglass icon in the Board page.');
				helpWin.para('&diams; You can see and stop a timer that was started from another device (works only if you have signed in to Chrome.)');
				helpWin.para('&diams; Timers under 20 seconds are ignored.');
				helpWin.para('&nbsp');

				helpWin.para('<b><h2 id="agile_help_moreless">More - Less</h2></b>');
				helpWin.para("&diams; Clicking 'Less' on the top bar hides boards entered over 2 weeks ago and cards with last activity over 4 weeks ago.");
				helpWin.para('&diams; Cards will hide only if you <A target="_blank" href="http://help.trello.com/customer/portal/articles/1256112-enabling-power-ups"> enable the Card Aging power-up</A> on each board.');
				helpWin.para('&nbsp');

				helpWin.para('<b><h2 id="agile_help_renamingmoving">Renaming boards or cards, moving, archiving, deleting</h2></b>');
				helpWin.para("&diams; You can rename boards and cards in Trello. Next time you report S/E on the board/card, Plus will rename them too.");
				helpWin.para("&diams; To force Plus to rename inmediately simply report an S/E of 0/0 on the card after renaming. If you renamed a board use any card in the board.");
				helpWin.para("&diams; Moving a card to another board is handled automatically by Plus, however if you moved the card outside of Plus you need to also report S/E of 0/0 after moving the card. All card history will move to the new board.");
				helpWin.para("&diams; Archiving or deleting cards currently has no effect on Plus, those will still show in reports.");
				helpWin.para("&diams; If you made a mistake on a card and want to void all its S/E, you need to have all team members that modified that card's S/E to report a negative S/E.");
				helpWin.para('&diams; Renaming a Trello user does NOT rename her in Plus, she will appear as a new user.');
				helpWin.para('&nbsp');

				helpWin.para('<b><h2 id="agile_help_burndowns">Board Burndowns</h2></b>');
				helpWin.para('<img src="' + chrome.extension.getURL("images/s4.png") + '"/>');
				helpWin.para('This show the ideal, well estimated board and spent progress.');
				helpWin.para('&diams; The green Remaining line starts high and steadily goes to zero.');
				helpWin.para('&diams; The blue Estimate line quickly climbs to a stabilized horizontal.');
				helpWin.para('&diams; The initial Estimate climb happens during the project estimation period.');
				helpWin.para('&diams; In that estimation period, the blue dots are on top of the green dots, since no Spent is beind done yet they are equal.');
				helpWin.para('&diams; The red Spent line steadily climbs daily, making the green line go down.');
				helpWin.para('&diams; At the end, the green line keeps staying at zero and there is no more Spent reported.');
				helpWin.para('&diams; Time to ship!');
				helpWin.para('&diams; Click on a dot to see more details and drill-down into its card.');
				helpWin.para('&diams; Click on a user Spent bar in the chart below to drill-down into all details.');
				helpWin.para('&diams; Detach the chrome window so you can resize and have create several board charts at once.');
				helpWin.para('&nbsp');

				helpWin.para('<b><h2 id="agile_help_reports">Custom Reports</h2></b>');
				helpWin.para('&diams; Use "Report" on the trello header to open the reports window.');
				helpWin.para('&diams; Once you build a report you can bookmark/email its URL to team members.');
				helpWin.para('&diams; Use "Copy" <IMG border="none" align="top" src="' + chrome.extension.getURL("images/copy.png") + '"></IMG> to export to the clipboard and paste on an email or spreadsheet.');
				helpWin.para('&diams; Drill-down on any chart bar or pivot cell to get a detailed report.');
				helpWin.para('&diams; No internet? no problem! Reports and dashboards work offline. Access them from the Plus icon in Chrome.');
				helpWin.para('&diams; The <b>E.type</b> column tells you if the row Estimate is new, increases or decreases an existing estimate by that user on that card.');
				helpWin.para('&diams; A blank E.type means the estimate was not affected.');
				helpWin.para('&nbsp');

				helpWin.para('<b><h2 id="agile_help_spendoldS">How to spend old estimates?</h2></b>');
				helpWin.para('If you used Plus before 2014 or came from trello3000/Scrum for Trello you may already have S/E in card titles.');
				helpWin.para('However those S/E you entered back then are not in the new historical database so Plus doesnt know to which user(s) those belong.');
				helpWin.para('If you try to spend a card with an old Estimate it will go into a negative Remain. To fix that you need to:');
				helpWin.para('&diams; 1. Rename the card title manually by clicking its title and setting its Estimate to zero.');
				helpWin.para('&diams; 2. Use the card S/E bar to add that estimate in the past (-10d for example).');
				helpWin.para('Similarly for old Spent already entered cards may appear in the Pending Cards section showing a Remain.');
				helpWin.para('To fix that you also need to manually reduce that Spent by renaming the card title, then Spend it using the card S/E bar.');
				helpWin.para('&nbsp');

				if (bSpentBackendCase) {
					helpWin.para('<b><h2 id="agile_help_spentbackend">For "Spent backend" users</h2></b>');
					helpWin.para('&diams; Add the @specialUser to the boards you want to report to Spent (write access, not observer.) Otherwise the comment reports will be ignored.');
					helpWin.para('&diams; To report S/E on a day before today, use this syntax: @specialUser -3d 2/0 comment. this tells it to report it 3 days ago.');
					helpWin.para('&diams; An admin can report as another user using the following format:');
					helpWin.para('&diams; @specialUser @user1 @user2 -2d S/E comment');
					helpWin.para('&diams; which will report the given S/E for user1 and user2. You can put as many users you want. Useful for meetings and for assigning estimates to team members.');
					helpWin.para('&diams; You may skip the S/E boxes and report the card comment directly, which also works from Trello mobile.');
					helpWin.para('&diams; Data for Card S/E, spreadsheets and reports are updated after an average of 50 seconds since the S/E was entered.');
					helpWin.para('&nbsp');
				}

				helpWin.para('<b><h2 id="agile_help_prefs">Preferences</h2></b>');
				if (bSpentBackendCase) {
					helpWin.para('Spent backend users cannot ignore missing estimates or import from Scrum for Trello');
				} else {
					var checkIgnoreZeroEst = helpWin.para('<input style="vertical-align:middle;" type="checkbox" class="agile_checkHelp" value="checkedIgnoreZeroEstimates" \
					>Ignore missing estimates. Cards with zero estimate and positive Spent will not appear in Pending cards.</input>').children('input:checkbox:first');
					if (g_bIgnoreZeroECards)
						checkIgnoreZeroEst[0].checked = true;

					checkIgnoreZeroEst.click(function () {
						var bValue = checkIgnoreZeroEst.is(':checked');
						var pair = {};
						pair["bIgnoreZeroECards"] = bValue;
						chrome.storage.sync.set(pair, function () { g_bIgnoreZeroECards = bValue; });
					});


					if (true) {
						var checkAcceptScrumForTrello = helpWin.para('<input style="vertical-align:middle;" type="checkbox" class="agile_checkHelp" value="checkedAcceptSFT">\
Accept and use Scrum for Trello format <i>(E) card title [S]</i>. <b>All team members must have the same setting</b> because cards with Scrum format will not be read or updated correctly by team members without this setting. Cards with the Plus format <i>(S/E) card title</i> will work regardless of this setting.</input>').children('input:checkbox:first');
						if (g_bAcceptSFT)
							checkAcceptScrumForTrello[0].checked = true;

						checkAcceptScrumForTrello.click(function () {
							var bValue = checkAcceptScrumForTrello.is(':checked');
							var pair = {};
							pair["bAcceptSFT"] = bValue;
							chrome.storage.sync.set(pair, function () { g_bAcceptSFT = bValue; });
						});
					}

				}
				helpWin.para('&nbsp');

				helpWin.para('<b><h2 id="agile_help_security">Privacy policy and Security notes</h2></b>');
				helpWin.para('Plus makes sure to secure all your Plus data. <A target="_blank" href="http://spentfortrello.blogspot.com/2014/02/plus-for-trello-security-notes.html">Read here</A> for more details.');
				helpWin.para('&nbsp');

				helpWin.para('<b><h2 id="agile_help_storage">Storage used</h2></b>');
				helpWin.para('&diams; chrome sync: ' + helpWin.storageTotalSync + " bytes.");
				helpWin.para('&diams; chrome local: ' + helpWin.storageTotalLocal + " bytes.");
				helpWin.para('&diams; html5 localStorage: ' + helpWin.storageTotalLocalStorage + " bytes.");
				helpWin.para('&diams; html5 web db: ' + helpWin.totalDbRowsHistory + " history rows.");
				helpWin.para('&diams; Reset storage by doing the Google sync setup again and changing or clearing the URL field.');
				helpWin.para('&nbsp');

				helpWin.para('<b><h2 id="agile_help_log">Plus local error log</h2></b>');
				helpWin.para('Errors logged: ' + helpWin.totalDbMessages + '. <A target="_blank" href="' + chrome.extension.getURL("plusmessages.html") + '">View log</A>');
				helpWin.para('&nbsp');

				var elemCloseBottom = helpWin.para('<span class="agile_help_close">(close help)</span>');
				elemCloseBottom.css('cursor', 'pointer');
				elemCloseBottom.click(function () {
					Help.close();
				});
				var body = $('body');
				container.hide();
				var toc = container.find("#tocAgileHelp");
				container.find("h2").each(function () {
					var el = $(this);
					var title = el.text();
					var id = el.attr("id");
					if (id) {
						var link = "#" + id;
						var li = $("<li>");
						var a = $("<a>").attr("href", link).text(" "+title).click(function () {
							setTimeout(function () {
								//prevent scrolling of body when clicking on a topic at the end
								$(body).scrollTop(0);
								var url = document.URL;
								var iPound = url.indexOf("#");
								if (iPound > 0) {
									url = url.substr(0,iPound);
									window.history.replaceState('data', '', url);
								}
							}, 50);
						});
						li.append(a);
						toc.append(li);
					}
				});
				body.append(container);
				container.fadeIn('fast', function () { container.focus(); });
			});
	},
	close: function () {
		var objHelp = this;
		this.m_container.fadeOut('fast', function () {
			var container = objHelp.m_container;
			objHelp.m_container = null;
			container.remove();
		});
	}
};