import React from "react";

import { useNavigate } from "react-router-dom";
import { Container } from "reactstrap";
import {useRecoilState} from "recoil";
import selectedGroupAtom from "../Recoil/selectedGroupAtom";
import Authentication from "../Authentication/authentication";

/**
 * Returns a button that when clicked, routes user to the appropriate group playback
 * @param props.group {JSON} Contains group information
 * @param props.householdID {string} Current household ID
 * @returns {JSX.Element} Group button
 */
export default function GroupRoutingController(props) {
  // Used to change currently displayed path and send data to new path
  let navigate = useNavigate();

  // groupStatusState (unused) accesses and setGroupStatusState modifies the state of groupStatusAtom
  const [selectedGroupState, setSelectedGroupState] = useRecoilState(selectedGroupAtom);

  /**
   * Sends the OAuth token and groupId to the server so Q-SYS can control this group.
   * @param {string} groupId - The selected group ID
   */
  const sendConfigToServer = (groupId) => {
    try {
      const auth = new Authentication();
      const token = auth.getAccessToken();
      fetch("http://localhost:8080/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, groupId })
      }).catch((err) => console.warn("[Q-SYS Config] Could not send config to server:", err));
    } catch (err) {
      console.warn("[Q-SYS Config] Could not read access token:", err);
    }
  };

  /**
   * onClick listener of button. Updates groupStatusAtom and navigates to group's path
   */
  const routeChange = () => {
    // Path to navigate to for current group
    let path = "../groups/" + props.group.id;

    // Updates the state of selectedGroupAtom to values of this button's group
    setSelectedGroupState({
      groupId: props.group.id,
      groupName: props.group.name,
      groupGoneFlag: false
    });

    // Send token + groupId to server so Q-SYS endpoints work
    sendConfigToServer(props.group.id);

    // Navigates to new path for current group, sending data for the group ID and household ID along with
    const data = {
      state: {
        householdId: props.householdId,
        groupId: props.group.id
      },
    };
    navigate(path, data);
  };

  // Returns button with routeChange as onClick listener
  return (
    <div className="group_det">
      <Container>
        <a onClick={routeChange}>
          <p className="group_ind">{props.group.name}</p>
        </a>
      </Container>
    </div>
  );
}
