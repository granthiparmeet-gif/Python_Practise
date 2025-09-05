Names = ["Parmeet", " Kaustubh", "Pranav", "Harsha", "Niru"]

def pattern(list, index=0):
    if index == len(list):
        return
    print(list[index])
    pattern(list, index+1)

pattern(Names)