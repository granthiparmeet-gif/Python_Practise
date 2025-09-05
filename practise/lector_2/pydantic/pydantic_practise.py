def  patient_data(name: str, age: int):
    if type(name)==str and type(age)==int:
        if(age)<=0:
            raise TypeError("Age cant be nnegative")
        else:
            print(f"age is {age}, name is {name}")
            print("Data is imported successfully")
            print(type(name), type(age))
    else:
        raise TypeError("Incorrect dataType")

patient_data("Parmeet", -3)